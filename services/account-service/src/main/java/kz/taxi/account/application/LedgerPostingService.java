package kz.taxi.account.application;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.LedgerEntry;
import kz.taxi.account.domain.LedgerOperation;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.account.infrastructure.LedgerEntryRepository;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Writes ledger entries, always in pairs.
 *
 * <p>Callers mutate the account entities first (so balances are current), then
 * call {@link #post}. Doing it the other way round would record a
 * {@code balanceAfterMinor} that never existed.
 *
 * <p>When the counter-party is "the outside world" (a demo top-up creating money,
 * a merchant settlement taking it out), the counter-entry goes to the per-currency
 * platform suspense account. Skipping it would be simpler and would quietly break
 * the only property that makes the ledger auditable: every transaction sums to zero.
 */
@Service
public class LedgerPostingService {

    private final LedgerEntryRepository ledgerEntryRepository;
    private final AccountRepository accountRepository;

    public LedgerPostingService(LedgerEntryRepository ledgerEntryRepository, AccountRepository accountRepository) {
        this.ledgerEntryRepository = ledgerEntryRepository;
        this.accountRepository = accountRepository;
    }

    /**
     * Posts a balanced movement of {@code amountMinor} from {@code source} to
     * {@code destination}, or to the suspense account when it is {@code null}.
     *
     * @return the transaction id shared by both entries
     */
    public String post(Account source,
                       Account destinationOrNull,
                       long amountMinor,
                       LedgerOperation operation,
                       String referenceType,
                       String referenceId,
                       String description) {

        Currency currency = source.getCurrency();
        Account destination = destinationOrNull != null ? destinationOrNull : suspenseAccount(currency);

        if (destination.getCurrency() != currency) {
            throw DomainException.of(AccountErrorCode.CURRENCY_MISMATCH,
                            "cannot post {} from account in {} to account in {}",
                            source.getId(), currency, destination.getCurrency())
                    .withDetail("sourceCurrency", currency.name())
                    .withDetail("destinationCurrency", destination.getCurrency().name());
        }

        String transactionId = Ulid.nextId();
        String correlationId = CorrelationContext.get();

        LedgerEntry debit = LedgerEntry.debit(transactionId, source, amountMinor, operation,
                referenceType, referenceId, description, correlationId);
        LedgerEntry credit = LedgerEntry.credit(transactionId, destination, amountMinor, operation,
                referenceType, referenceId, description, correlationId);

        ledgerEntryRepository.saveAll(List.of(debit, credit));
        return transactionId;
    }

    /**
     * The suspense account for a currency, created on first use.
     *
     * <p>Created lazily rather than only at startup so that a currency can be
     * introduced (or its system account deleted by accident) without a deploy.
     */
    public Account suspenseAccount(Currency currency) {
        return accountRepository.findFirstByTypeAndCurrencyAndStatus(AccountType.SYSTEM, currency,
                        kz.taxi.account.domain.AccountStatus.ACTIVE)
                .orElseGet(() -> accountRepository.save(Account.openSystemAccount(currency)));
    }

    /** Every entry of one transaction, oldest first — used by tests and support tools. */
    public List<LedgerEntry> entriesOf(String transactionId) {
        return ledgerEntryRepository.findByTransactionIdOrderByCreatedAtAsc(transactionId);
    }
}
