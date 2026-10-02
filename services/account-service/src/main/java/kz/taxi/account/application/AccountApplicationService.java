package kz.taxi.account.application;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountDebitSupport;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.HoldStatus;
import kz.taxi.account.domain.LedgerEntry;
import kz.taxi.account.domain.LedgerOperation;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.account.infrastructure.LedgerEntryRepository;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.common.security.AuthenticatedUser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * Use cases a customer (or an operator) can trigger.
 *
 * <p>Authorization lives here rather than in the controller: "may this caller see
 * this account" is a business rule, and putting it in one place means a new
 * endpoint cannot forget it.
 */
@Service
@Slf4j
public class AccountApplicationService {

    private final AccountRepository accountRepository;
    private final AccountHoldRepository accountHoldRepository;
    private final LedgerEntryRepository ledgerEntryRepository;
    private final LedgerPostingService ledgerPostingService;
    private final OutboxWriter outboxWriter;

    public AccountApplicationService(AccountRepository accountRepository,
                                     AccountHoldRepository accountHoldRepository,
                                     LedgerEntryRepository ledgerEntryRepository,
                                     LedgerPostingService ledgerPostingService,
                                     OutboxWriter outboxWriter) {
        this.accountRepository = accountRepository;
        this.accountHoldRepository = accountHoldRepository;
        this.ledgerEntryRepository = ledgerEntryRepository;
        this.ledgerPostingService = ledgerPostingService;
        this.outboxWriter = outboxWriter;
    }

    // ------------------------------------------------------------------ accounts

    @Transactional
    public Account createAccount(String userId, String phone, String displayName, Currency currency, AccountType type) {
        if (type == AccountType.SYSTEM) {
            throw DomainException.of(AccountErrorCode.FORBIDDEN_ACCOUNT_ACCESS,
                    "system accounts cannot be created through the API");
        }
        if (accountRepository.existsByOwnerUserIdAndCurrencyAndType(userId, currency, type)) {
            throw DomainException.of(AccountErrorCode.ACCOUNT_ALREADY_EXISTS,
                            "user {} already has a {} account in {}", userId, type, currency)
                    .withDetail("currency", currency.name())
                    .withDetail("type", type.name());
        }

        Account account = accountRepository.save(Account.open(userId, phone, displayName, type, currency));
        outboxWriter.append(KafkaTopics.ACCOUNT_EVENTS, KafkaTopics.Events.ACCOUNT_CREATED,
                "Account", account.getId(), account.getVersion(),
                new AccountEvents.AccountCreated(account.getId(), account.getOwnerUserId(),
                        account.getType().name(), account.getCurrency().name(), account.getStatus().name(),
                        Instant.now()));
        log.info("opened {} account {} in {} for user {}", type, account.getId(), currency, userId);
        return account;
    }

    @Transactional(readOnly = true)
    public List<Account> listAccounts(String userId) {
        return accountRepository.findByOwnerUserIdOrderByCreatedAtAsc(userId);
    }

    @Transactional(readOnly = true)
    public Account getAccount(String accountId, AuthenticatedUser requester) {
        Account account = requireAccount(accountId);
        requireAccess(account, requester);
        return account;
    }

    @Transactional(readOnly = true)
    public Page<LedgerEntry> transactions(String accountId, AuthenticatedUser requester, Pageable pageable) {
        requireAccess(requireAccount(accountId), requester);
        return ledgerEntryRepository.findByAccountIdOrderByCreatedAtDesc(accountId, pageable);
    }

    @Transactional(readOnly = true)
    public Page<AccountHold> holds(String accountId, HoldStatus status, AuthenticatedUser requester, Pageable pageable) {
        requireAccess(requireAccount(accountId), requester);
        return status == null
                ? accountHoldRepository.findByAccountIdOrderByCreatedAtDesc(accountId, pageable)
                : accountHoldRepository.findByAccountIdAndStatusOrderByCreatedAtDesc(accountId, status, pageable);
    }

    // ------------------------------------------------------------------ operator actions

    /**
     * Creates money on an account.
     *
     * <p>Operator-only and deliberately loud in the ledger: the counter-entry lands
     * on the platform suspense account, so a demo top-up is visible as "funds came
     * from outside the system" rather than as an unexplained balance increase.
     */
    @Transactional
    public Account topUp(String accountId, long amountMinor, String reason, AuthenticatedUser requester) {
        if (!requester.isAdmin()) {
            throw DomainException.forbidden("only an operator may top up an account");
        }

        Account account = accountRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> notFound(accountId));
        Account suspense = ledgerPostingService.suspenseAccount(account.getCurrency());

        account.credit(amountMinor, account.getCurrency());
        AccountDebitSupport.debit(suspense, amountMinor, account.getCurrency());

        String transactionId = ledgerPostingService.post(suspense, account, amountMinor,
                LedgerOperation.TOP_UP, "TOP_UP", Ulid.nextId(), reason);

        outboxWriter.append(KafkaTopics.ACCOUNT_EVENTS, KafkaTopics.Events.ACCOUNT_BALANCE_CHANGED,
                "Account", account.getId(), account.getVersion(),
                new AccountEvents.BalanceChanged(account.getId(), transactionId, account.getBalanceMinor(),
                        account.getHeldMinor(), account.availableMinor(), account.getCurrency().name(),
                        LedgerOperation.TOP_UP.name(), "TOP_UP", transactionId, Instant.now()));

        log.info("operator {} topped up account {} with {} {} ({})", requester.userId(), accountId,
                amountMinor, account.getCurrency(), reason);
        return account;
    }

    // ------------------------------------------------------------------ helpers

    private Account requireAccount(String accountId) {
        return accountRepository.findById(accountId).orElseThrow(() -> notFound(accountId));
    }

    private static DomainException notFound(String accountId) {
        return DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND, "account {} not found", accountId)
                .withDetail("accountId", accountId);
    }

    /** Owner, or an operator role. Everyone else gets a 403, never a 404 leak. */
    private static void requireAccess(Account account, AuthenticatedUser requester) {
        if (requester == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!requester.canAccess(account.getOwnerUserId())) {
            throw DomainException.of(AccountErrorCode.FORBIDDEN_ACCOUNT_ACCESS,
                            "account {} belongs to another user", account.getId())
                    .withDetail("accountId", account.getId());
        }
    }
}
