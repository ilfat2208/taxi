package kz.taxi.payment.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.SettlementStatus;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.CatalogMerchantClient;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.SettlementProperties;
import kz.taxi.payment.infrastructure.SettlementRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Settlement orchestration: decide who is owed money, then pay it.
 *
 * <p>No transaction spans this class — every call that touches the database is a
 * short transaction inside {@link SettlementStateService}, and every remote call
 * happens outside any transaction. That shape exists because a payout involves two
 * services and a bank-like delay: holding a database transaction open across it
 * would turn a slow catalog lookup into a locked settlement table.
 *
 * <p>Failure policy, in order of importance:
 * <ol>
 *   <li>a merchant whose sales cannot be computed is skipped, not charged differently
 *       — one broken merchant must not stop everyone else's payout;</li>
 *   <li>a settlement with nowhere to go stays {@code PENDING}: the debt is recorded
 *       and visible, which is strictly better than guessing an account;</li>
 *   <li>a payout that fails becomes {@code FAILED} and is retried — money owed does
 *       not stop being owed because a call timed out.</li>
 * </ol>
 */
@Service
@Slf4j
public class SettlementService {

    /** What one run did; returned for the admin endpoint, logs and tests. */
    public record RunSummary(int computed, int paid, int failed, int awaitingPayoutAccount, int nothingToSettle) {

        static RunSummary of(List<MerchantSettlement> settlements,
                             int paid,
                             int failed,
                             int awaitingPayoutAccount,
                             int nothingToSettle) {
            return new RunSummary(settlements.size(), paid, failed, awaitingPayoutAccount, nothingToSettle);
        }

        public boolean didAnything() {
            return computed > 0 || paid > 0 || failed > 0;
        }
    }

    /** Ledger reference of a payout: what the account service's idempotency hangs on. */
    static final String REFERENCE_SETTLEMENT = "SETTLEMENT";

    /**
     * Ledger operation of a payout — and it must be one the account service knows.
     *
     * <p>{@code SETTLEMENT} is deliberately not used here even though it reads better
     * in a log: {@code operation} is deserialised into account-service's
     * {@code LedgerOperation} enum, an unknown name fails Jackson, and the payout dies
     * with a generic "request body is missing or malformed" instead of moving money.
     * A merchant payout <em>is</em> a {@code PAYOUT}; the reference type carries the
     * settlement identity.
     */
    static final String OPERATION_SETTLEMENT = "PAYOUT";

    private final PaymentRepository payments;
    private final SettlementRepository settlements;
    private final SettlementStateService state;
    private final CatalogMerchantClient merchants;
    private final AccountServiceClient accounts;
    private final SettlementProperties properties;

    public SettlementService(PaymentRepository payments,
                             SettlementRepository settlements,
                             SettlementStateService state,
                             CatalogMerchantClient merchants,
                             AccountServiceClient accounts,
                             SettlementProperties properties) {
        this.payments = payments;
        this.settlements = settlements;
        this.state = state;
        this.merchants = merchants;
        this.accounts = accounts;
        this.properties = properties;
    }

    /**
     * One settlement pass: compute what is due and, when configured, pay it.
     *
     * @return a summary an operator (and a test) can assert on
     */
    public RunSummary runOnce() {
        Instant cutoff = Instant.now().minus(properties.holdPeriod());
        List<SettlementCandidate> candidates = payments.findMerchantsWithUnsettledSales(
                cutoff, PageRequest.of(0, properties.batchSize()));

        List<MerchantSettlement> computed = new java.util.ArrayList<>();
        int paid = 0;
        int failed = 0;
        int awaitingAccount = 0;
        int nothing = 0;

        for (SettlementCandidate candidate : candidates) {
            try {
                Optional<MerchantSettlement> settlement = computeFor(candidate, cutoff);
                if (settlement.isEmpty()) {
                    nothing++;
                    continue;
                }
                computed.add(settlement.get());

                MerchantSettlement afterPayout = payOut(settlement.get());
                if (afterPayout.getStatus() == SettlementStatus.PAID) {
                    paid++;
                } else if (afterPayout.getStatus() == SettlementStatus.FAILED) {
                    failed++;
                } else {
                    awaitingAccount++;
                }
            } catch (DomainException refusal) {
                // A business refusal for one merchant (unknown merchant, catalog
                // incident) must not abort the whole run: the others are still owed.
                log.warn("settlement skipped for merchant {} in {}: {}",
                        candidate.merchantId(), candidate.currency(), refusal.getMessage());
                failed++;
            } catch (RuntimeException unexpected) {
                log.error("settlement failed unexpectedly for merchant {} in {}",
                        candidate.merchantId(), candidate.currency(), unexpected);
                failed++;
            }
        }

        RunSummary summary = RunSummary.of(computed, paid, failed, awaitingAccount, nothing);
        if (summary.didAnything()) {
            log.info("settlement run: computed={}, paid={}, failed={}, awaitingPayoutAccount={}, nothingToSettle={}",
                    summary.computed(), summary.paid(), summary.failed(),
                    summary.awaitingPayoutAccount(), summary.nothingToSettle());
        }
        return summary;
    }

    /**
     * Retries everything still owed, including settlements that failed earlier.
     *
     * <p>Separate from {@link #runOnce()} because the two do different jobs: one
     * turns sales into debts, the other turns debts into payments. Retrying a failed
     * payout is idempotent — the ledger reference is the settlement id — so a crash
     * between "money moved" and "status saved" cannot pay twice.
     */
    public RunSummary retryPayable() {
        List<MerchantSettlement> payable = state.claimPayable(properties.batchSize());
        int paid = 0;
        int failed = 0;
        int awaitingAccount = 0;

        for (MerchantSettlement settlement : payable) {
            try {
                MerchantSettlement after = payOut(settlement);
                if (after.getStatus() == SettlementStatus.PAID) {
                    paid++;
                } else if (after.getStatus() == SettlementStatus.FAILED) {
                    failed++;
                } else {
                    awaitingAccount++;
                }
            } catch (RuntimeException failure) {
                log.error("payout retry failed for settlement {}", settlement.getSettlementNumber(), failure);
                failed++;
            }
        }
        if (paid + failed + awaitingAccount > 0) {
            log.info("settlement retry: paid={}, failed={}, awaitingPayoutAccount={}", paid, failed, awaitingAccount);
        }
        return new RunSummary(0, paid, failed, awaitingAccount, 0);
    }

    /**
     * Pays one settlement, or explains why it cannot be paid yet.
     *
     * <p>A settlement without a payout account is left {@code PENDING} rather than
     * failed: nothing is wrong, the merchant simply has not said where the money
     * should go.
     */
    public MerchantSettlement payOut(MerchantSettlement settlement) {
        if (!settlement.isPayable()) {
            return settlement;
        }
        if (!settlement.hasPayoutAccount()) {
            log.warn("settlement {} stays PENDING: merchant {} has not chosen a payout account",
                    settlement.getSettlementNumber(), settlement.getMerchantId());
            return settlement;
        }

        MerchantSettlement current = settlement;
        try {
            AccountServiceClient.CreditResult credit = accounts.credit(new AccountServiceClient.CreditRequest(
                    settlement.getPayoutAccountId(),
                    settlement.getNetMinor(),
                    settlement.getCurrency(),
                    REFERENCE_SETTLEMENT,
                    settlement.getId(),
                    OPERATION_SETTLEMENT,
                    "settlement " + settlement.getSettlementNumber()));
            return state.markPaid(settlement.getId(), credit.transactionId());
        } catch (DomainException refused) {
            // Includes the case of an account the merchant redirected or closed after
            // the settlement was computed: the debt stays on the books.
            if (refused.errorCode() == PaymentErrorCode.MERCHANT_PAYOUT_ACCOUNT_MISSING) {
                log.warn("settlement {} cannot be paid: {}", settlement.getSettlementNumber(), refused.getMessage());
                return current;
            }
            return state.markFailed(settlement.getId(), refused.getMessage());
        }
    }

    /**
     * Computes one merchant's settlement.
     *
     * <p>The merchant snapshot is read first and outside the transaction: the payout
     * account is what decides whether this debt can be paid, and reading it inside
     * the transaction would mean a slow catalog service holds a lock on the
     * settlement table.
     */
    private Optional<MerchantSettlement> computeFor(SettlementCandidate candidate, Instant cutoff) {
        CatalogMerchantClient.MerchantSnapshot merchant = merchants.merchant(candidate.merchantId());
        return state.createSettlement(candidate.merchantId(), candidate.currency(), cutoff,
                merchant.ownerUserId(), merchant.payoutAccountId());
    }
}
