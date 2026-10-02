package kz.taxi.account.application;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountDebitSupport;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.AccountStatus;
import kz.taxi.account.domain.HoldStatus;
import kz.taxi.account.domain.LedgerDirection;
import kz.taxi.account.domain.LedgerEntry;
import kz.taxi.account.domain.LedgerOperation;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.account.infrastructure.LedgerEntryRepository;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * The money API used by other services.
 *
 * <p>This is where idempotency has to be real rather than decorative. payment-service
 * drives a saga, and a saga that crashes after reserving funds will retry: every
 * operation here is therefore either explicitly idempotent (same
 * {@code idempotencyKey} or same business reference returns the original result)
 * or terminal (capturing a captured hold returns the original transaction instead
 * of moving money a second time).
 */
@Service
@Slf4j
public class InternalAccountApplicationService {

    /** Ledger entries produced by a hold capture are referenced by the hold itself. */
    public static final String REFERENCE_HOLD = "HOLD";

    public record PlaceHoldResult(AccountHold hold, Account account, boolean replayed) {
    }

    public record CaptureResult(String transactionId,
                                AccountHold hold,
                                String sourceAccountId,
                                String targetAccountId,
                                boolean replayed,
                                boolean expired) {
    }

    public record CreditResult(String transactionId, Account account, long balanceAfterMinor, boolean replayed) {
    }

    private final AccountRepository accountRepository;
    private final AccountHoldRepository accountHoldRepository;
    private final LedgerEntryRepository ledgerEntryRepository;
    private final LedgerPostingService ledgerPostingService;
    private final OutboxWriter outboxWriter;
    private final AccountLimitGuard limitGuard;
    private final Clock clock;
    private final Duration holdTtl;

    public InternalAccountApplicationService(AccountRepository accountRepository,
                                             AccountHoldRepository accountHoldRepository,
                                             LedgerEntryRepository ledgerEntryRepository,
                                             LedgerPostingService ledgerPostingService,
                                             OutboxWriter outboxWriter,
                                             AccountLimitGuard limitGuard,
                                             Clock clock,
                                             @Value("${taxi.account.hold-ttl:15m}") Duration holdTtl) {
        this.accountRepository = accountRepository;
        this.accountHoldRepository = accountHoldRepository;
        this.ledgerEntryRepository = ledgerEntryRepository;
        this.ledgerPostingService = ledgerPostingService;
        this.outboxWriter = outboxWriter;
        this.limitGuard = limitGuard;
        this.clock = clock;
        this.holdTtl = holdTtl;
    }

    // ------------------------------------------------------------------ holds

    @Transactional
    public PlaceHoldResult placeHold(String accountId,
                                     long amountMinor,
                                     Currency currency,
                                     String referenceType,
                                     String referenceId,
                                     String idempotencyKey,
                                     String reason) {

        // Lock the account first: it both serialises concurrent money movement and
        // makes the idempotency re-check below authoritative (two replicas handling
        // the same retried request queue behind this lock instead of racing).
        Account account = accountRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                "account {} not found", accountId)
                        .withDetail("accountId", accountId));

        Optional<AccountHold> existing = accountHoldRepository.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            AccountHold hold = existing.get();
            if (hold.getAmountMinor() != amountMinor || !hold.getReferenceId().equals(referenceId)) {
                throw DomainException.of(CommonErrorCode.IDEMPOTENCY_CONFLICT,
                                "idempotency key '{}' was already used for a different hold", idempotencyKey)
                        .withDetail("holdId", hold.getId());
            }
            log.debug("replaying hold {} for idempotency key {}", hold.getId(), idempotencyKey);
            return new PlaceHoldResult(hold, account, true);
        }

        Instant now = clock.instant();

        // Limits and velocity are checked here, before reserve(): a refused operation
        // must not leave reserved funds behind, and the customer must not learn about
        // the ceiling after the money was already promised to a merchant.
        limitGuard.ensureAllowed(account, amountMinor, currency, now);

        account.reserve(amountMinor, currency);
        AccountHold hold = accountHoldRepository.save(AccountHold.place(account.getId(), amountMinor, currency,
                referenceType, referenceId, idempotencyKey, reason, now.plus(holdTtl)));

        // Charge the window the hold landed in, in this same transaction: a hold that
        // rolls back must not leave limit usage behind. The instant comes from the hold
        // itself, so a release later refunds to exactly the bucket that was charged —
        // charge and refund can never disagree about which window they mean.
        limitGuard.recordPlacement(account, hold.getAmountMinor(), hold.getCurrency(), hold.getCreatedAt());

        publishHoldChange(KafkaTopics.Events.ACCOUNT_HOLD_PLACED, hold);
        publishBalanceChange(account, null, LedgerOperation.P2P_TRANSFER, referenceType, referenceId);

        log.info("reserved {} {} on account {} for {} {} (hold {})",
                amountMinor, currency, accountId, referenceType, referenceId, hold.getId());
        return new PlaceHoldResult(hold, account, false);
    }

    @Transactional
    public CaptureResult captureHold(String holdId,
                                     String targetAccountId,
                                     LedgerOperation requestedOperation,
                                     String description) {

        AccountHold hold = accountHoldRepository.findByIdForUpdate(holdId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.HOLD_NOT_FOUND,
                                "hold {} not found", holdId)
                        .withDetail("holdId", holdId));

        if (hold.getStatus() == HoldStatus.CAPTURED) {
            String originalTransaction = findCaptureTransaction(holdId);
            log.debug("hold {} was already captured, replaying transaction {}", holdId, originalTransaction);
            return new CaptureResult(originalTransaction, hold, hold.getAccountId(), targetAccountId, true, false);
        }
        if (!hold.isActive()) {
            throw DomainException.of(AccountErrorCode.HOLD_NOT_ACTIVE,
                            "hold {} is {}", holdId, hold.getStatus())
                    .withDetail("holdId", holdId)
                    .withDetail("status", hold.getStatus().name());
        }

        Account source = accountRepository.findByIdForUpdate(hold.getAccountId())
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                        "account {} not found", hold.getAccountId()));

        if (hold.isExpired(Instant.now())) {
            // The funds were already given back by the expiry job; capturing now
            // would move money that is no longer reserved.
            hold.expire();
            publishHoldChange(KafkaTopics.Events.ACCOUNT_HOLD_RELEASED, hold);
            throw DomainException.of(AccountErrorCode.HOLD_EXPIRED,
                            "hold {} expired at {} and its funds were released", holdId, hold.getExpiresAt())
                    .withDetail("holdId", holdId);
        }

        Account target = null;
        if (targetAccountId != null) {
            target = accountRepository.findByIdForUpdate(targetAccountId)
                    .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                    "target account {} not found", targetAccountId)
                            .withDetail("accountId", targetAccountId));
        }

        // Where the money lands. With a target account it is a P2P movement; without
        // one the money leaves the closed system and the counter-entry goes to the
        // platform suspense account.
        //
        // The destination must be resolved (and its balance mutated) HERE, not inside
        // the posting helper: a ledger entry records `balance_after`, so writing the
        // credit without applying it would make the account row and the ledger
        // disagree by exactly the amount that was captured — the one divergence that
        // makes reconciliation impossible.
        Account destination = target != null ? target : ledgerPostingService.suspenseAccount(hold.getCurrency());

        source.debitReserved(hold.getAmountMinor());
        destination.credit(hold.getAmountMinor(), hold.getCurrency());

        LedgerOperation operation = requestedOperation != null
                ? requestedOperation
                : (target != null ? LedgerOperation.P2P_TRANSFER : LedgerOperation.MERCHANT_PAYMENT);

        String transactionId = ledgerPostingService.post(source, destination, hold.getAmountMinor(), operation,
                REFERENCE_HOLD, hold.getId(),
                description == null ? "capture of hold " + hold.getId() : description);

        hold.capture();
        publishHoldChange(KafkaTopics.Events.ACCOUNT_HOLD_CAPTURED, hold);
        publishBalanceChange(source, transactionId, operation, hold.getReferenceType(), hold.getReferenceId());
        publishBalanceChange(destination, transactionId, operation, hold.getReferenceType(), hold.getReferenceId());

        log.info("captured hold {} ({} {} from account {} to {}) as transaction {}", holdId,
                hold.getAmountMinor(), hold.getCurrency(), source.getId(),
                target == null ? "the platform suspense account" : "account " + target.getId(), transactionId);
        return new CaptureResult(transactionId, hold, source.getId(), targetAccountId, false, false);
    }

    @Transactional
    public AccountHold releaseHold(String holdId, String reason) {
        AccountHold hold = accountHoldRepository.findByIdForUpdate(holdId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.HOLD_NOT_FOUND,
                                "hold {} not found", holdId)
                        .withDetail("holdId", holdId));

        if (hold.getStatus() == HoldStatus.RELEASED || hold.getStatus() == HoldStatus.EXPIRED) {
            log.debug("hold {} is already {}, nothing to release", holdId, hold.getStatus());
            return hold;
        }
        if (hold.getStatus() == HoldStatus.CAPTURED) {
            throw DomainException.of(AccountErrorCode.HOLD_NOT_ACTIVE,
                            "hold {} was already captured; refund it through a payment reversal instead", holdId)
                    .withDetail("holdId", holdId);
        }

        Account account = accountRepository.findByIdForUpdate(hold.getAccountId())
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                        "account {} not found", hold.getAccountId()));

        account.releaseReserved(hold.getAmountMinor());
        hold.release();

        // A released hold consumed nothing, so its limit budget goes back to the
        // window it was charged to. Without this, a cancelled payment would keep
        // eating the customer's daily ceiling all day.
        limitGuard.recordRelease(account, hold.getAmountMinor(), hold.getCreatedAt());

        publishHoldChange(KafkaTopics.Events.ACCOUNT_HOLD_RELEASED, hold);
        publishBalanceChange(account, null, LedgerOperation.P2P_TRANSFER, hold.getReferenceType(), hold.getReferenceId());

        log.info("released hold {} ({} {} back to account {}) because {}",
                holdId, hold.getAmountMinor(), hold.getCurrency(), account.getId(), reason);
        return hold;
    }

    // ------------------------------------------------------------------ credits

    /**
     * Credits an account from outside the system (recipient of a transfer, refund,
     * payout) with exactly-once semantics per business reference.
     */
    @Transactional
    public CreditResult credit(String accountId,
                               long amountMinor,
                               Currency currency,
                               String referenceType,
                               String referenceId,
                               LedgerOperation requestedOperation,
                               String description) {

        // The business reference is the idempotency anchor here: a saga retrying a
        // payout after a timeout must not pay twice, and it does not know (or need)
        // a client key at this point.
        if (ledgerEntryRepository.existsByReferenceTypeAndReferenceId(referenceType, referenceId)) {
            Optional<LedgerEntry> original = ledgerEntryRepository
                    .findFirstByReferenceTypeAndReferenceIdAndDirectionOrderByCreatedAtDesc(
                            referenceType, referenceId, LedgerDirection.CREDIT);
            if (original.isPresent()) {
                Account account = accountRepository.findById(accountId)
                        .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                "account {} not found", accountId));
                log.debug("credit for {} {} already posted as transaction {}",
                        referenceType, referenceId, original.get().getTransactionId());
                return new CreditResult(original.get().getTransactionId(), account,
                        original.get().getBalanceAfterMinor(), true);
            }
        }

        Account account = accountRepository.findByIdForUpdate(accountId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                "account {} not found", accountId)
                        .withDetail("accountId", accountId));

        if (account.getCurrency() != currency) {
            throw DomainException.of(AccountErrorCode.CURRENCY_MISMATCH,
                            "account {} is in {} but {} was supplied", accountId, account.getCurrency(), currency)
                    .withDetail("accountCurrency", account.getCurrency().name())
                    .withDetail("requestCurrency", currency.name());
        }

        Account suspense = ledgerPostingService.suspenseAccount(currency);
        account.credit(amountMinor, currency);
        AccountDebitSupport.debit(suspense, amountMinor, currency);

        LedgerOperation operation = requestedOperation != null ? requestedOperation : LedgerOperation.REFUND;
        String transactionId = ledgerPostingService.post(suspense, account, amountMinor, operation,
                referenceType, referenceId, description);

        publishBalanceChange(account, transactionId, operation, referenceType, referenceId);

        log.info("credited {} {} to account {} ({}) as transaction {}",
                amountMinor, currency, accountId, referenceType + "/" + referenceId, transactionId);
        return new CreditResult(transactionId, account, account.getBalanceMinor(), false);
    }

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public Account resolveByPhone(String phone, Currency currency) {
        return accountRepository
                .findFirstByOwnerPhoneAndCurrencyAndStatusOrderByCreatedAtAsc(phone, currency, AccountStatus.ACTIVE)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                "no active {} account is registered for phone {}", currency, phone)
                        .withDetail("phone", phone)
                        .withDetail("currency", currency.name()));
    }

    @Transactional(readOnly = true)
    public Account view(String accountId) {
        return accountRepository.findById(accountId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                "account {} not found", accountId)
                        .withDetail("accountId", accountId));
    }

    @Transactional(readOnly = true)
    public AccountHold hold(String holdId) {
        return accountHoldRepository.findById(holdId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.HOLD_NOT_FOUND,
                                "hold {} not found", holdId)
                        .withDetail("holdId", holdId));
    }

    /** Lets a recovering saga ask "did I already reserve funds for this payment?". */
    @Transactional(readOnly = true)
    public Optional<AccountHold> findActiveHold(String referenceType, String referenceId, String accountId) {
        return accountHoldRepository.findFirstByReferenceTypeAndReferenceIdAndAccountIdAndStatus(
                referenceType, referenceId, accountId, HoldStatus.ACTIVE);
    }

    // ------------------------------------------------------------------ expiry

    /**
     * Releases funds reserved by payments that were never finished.
     *
     * <p>Without this, a crashed checkout would freeze a customer's money forever —
     * the kind of bug that shows up as an angry support ticket rather than an
     * exception. Expiry is idempotent and safe to run from every replica: the hold
     * row lock makes a second runner skip what the first one already released.
     *
     * @return how many holds were expired
     */
    @Transactional
    public int expireDueHolds(int batchSize) {
        List<AccountHold> due = accountHoldRepository.findByStatusAndExpiresAtBefore(
                HoldStatus.ACTIVE, Instant.now(), PageRequest.of(0, batchSize));
        int expired = 0;
        for (AccountHold candidate : due) {
            AccountHold hold = accountHoldRepository.findByIdForUpdate(candidate.getId()).orElse(null);
            if (hold == null || !hold.isActive()) {
                continue;
            }
            Account account = accountRepository.findByIdForUpdate(hold.getAccountId()).orElse(null);
            if (account == null) {
                log.error("hold {} references missing account {}, skipping", hold.getId(), hold.getAccountId());
                continue;
            }
            account.releaseReserved(hold.getAmountMinor());
            hold.expire();
            limitGuard.recordRelease(account, hold.getAmountMinor(), hold.getCreatedAt());
            publishHoldChange(KafkaTopics.Events.ACCOUNT_HOLD_RELEASED, hold);
            publishBalanceChange(account, null, LedgerOperation.P2P_TRANSFER, hold.getReferenceType(), hold.getReferenceId());
            expired++;
            log.info("expired hold {} and returned {} {} to account {}",
                    hold.getId(), hold.getAmountMinor(), hold.getCurrency(), account.getId());
        }
        return expired;
    }

    // ------------------------------------------------------------------ internals

    private String findCaptureTransaction(String holdId) {
        return ledgerEntryRepository
                .findFirstByReferenceTypeAndReferenceIdAndDirectionOrderByCreatedAtDesc(
                        REFERENCE_HOLD, holdId, LedgerDirection.DEBIT)
                .map(LedgerEntry::getTransactionId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.LEDGER_INVARIANT_VIOLATION,
                        "hold {} is captured but has no ledger entry", holdId));
    }

    private void publishHoldChange(String eventType, AccountHold hold) {
        outboxWriter.append(KafkaTopics.ACCOUNT_EVENTS, eventType, "AccountHold", hold.getId(), hold.getVersion(),
                new AccountEvents.HoldChanged(hold.getId(), hold.getAccountId(), hold.getAmountMinor(),
                        hold.getCurrency().name(), hold.getStatus().name(), hold.getReferenceType(),
                        hold.getReferenceId(), Instant.now()));
    }

    private void publishBalanceChange(Account account,
                                      String transactionId,
                                      LedgerOperation operation,
                                      String referenceType,
                                      String referenceId) {
        outboxWriter.append(KafkaTopics.ACCOUNT_EVENTS, KafkaTopics.Events.ACCOUNT_BALANCE_CHANGED,
                "Account", account.getId(), account.getVersion(),
                new AccountEvents.BalanceChanged(account.getId(), transactionId, account.getBalanceMinor(),
                        account.getHeldMinor(), account.availableMinor(), account.getCurrency().name(),
                        operation.name(), referenceType, referenceId, Instant.now()));
    }

    /** Rendered for logs and error details so nobody has to divide by 100 in their head. */
    static String format(long amountMinor, Currency currency) {
        return Money.ofMinor(amountMinor, currency).toString();
    }
}
