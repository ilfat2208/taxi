package kz.taxi.payment.application;

import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.SettlementStatus;
import kz.taxi.payment.domain.SettlementPayment;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.SettlementPaymentRepository;
import kz.taxi.payment.infrastructure.SettlementRepository;
import kz.taxi.common.core.error.DomainException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * The transactional half of settlement: every state change and its event, in one
 * transaction, with no remote call in sight.
 *
 * <p>It is a separate bean from {@link SettlementService} on purpose. A
 * {@code @Transactional} method called from another method of the same class runs
 * without a transaction (self-invocation bypasses the proxy) — a trap that in this
 * very project once produced "Query requires transaction be in progress" at startup.
 * Keeping the orchestration and the transactions in different beans makes the
 * boundary impossible to miss.
 */
@Service
@Slf4j
public class SettlementStateService {

    private final PaymentRepository payments;
    private final SettlementRepository settlements;
    private final SettlementPaymentRepository settlementPayments;
    private final OutboxWriter outboxWriter;
    private final PaymentMetrics metrics;

    public SettlementStateService(PaymentRepository payments,
                                  SettlementRepository settlements,
                                  SettlementPaymentRepository settlementPayments,
                                  OutboxWriter outboxWriter,
                                  PaymentMetrics metrics) {
        this.payments = payments;
        this.settlements = settlements;
        this.settlementPayments = settlementPayments;
        this.outboxWriter = outboxWriter;
        this.metrics = metrics;
    }

    /**
     * Computes what is owed for one merchant and currency and takes those sales off
     * the payable list.
     *
     * <p>Everything that makes the payout defensible happens here, in one
     * transaction:
     * <ul>
     *   <li>the sales are locked, so two runs cannot both include them;</li>
     *   <li>{@code settlement_payment.payment_id} is the primary key, so the database
     *       refuses a second settlement for the same sale even under a race;</li>
     *   <li>the settlement and its {@code settlement.created} event commit together —
     *       the debt becomes visible at the same instant it becomes real.</li>
     * </ul>
     *
     * @return the settlement, or empty when there is nothing to settle
     */
    @Transactional
    public Optional<MerchantSettlement> createSettlement(String merchantId,
                                                         Currency currency,
                                                         Instant cutoff,
                                                         String ownerUserId,
                                                         String payoutAccountId) {

        String idempotencyKey = MerchantSettlement.idempotencyKey(merchantId, currency, cutoff);
        Optional<MerchantSettlement> alreadyComputed = settlements.findByIdempotencyKey(idempotencyKey);
        if (alreadyComputed.isPresent()) {
            log.debug("settlement for {} {} at {} already exists ({})",
                    merchantId, currency, cutoff, alreadyComputed.get().getSettlementNumber());
            return alreadyComputed;
        }

        List<Payment> sales = payments.findUnsettledSales(merchantId, currency, cutoff);
        if (sales.isEmpty()) {
            return Optional.empty();
        }

        long gross = 0;
        long commission = 0;
        long customerPaid = 0;
        Instant periodStart = sales.get(0).getCompletedAt();
        for (Payment sale : sales) {
            gross += sale.getAmountMinor();
            commission += sale.getFeeMinor();
            customerPaid += sale.getTotalMinor();
            if (sale.getCompletedAt().isBefore(periodStart)) {
                periodStart = sale.getCompletedAt();
            }
        }

        MerchantSettlement settlement = settlements.save(MerchantSettlement.of(
                merchantId, ownerUserId, payoutAccountId, currency, periodStart, cutoff,
                new MerchantSettlement.PeriodTotals(sales.size(), gross, commission, customerPaid)));

        Instant now = Instant.now();
        for (Payment sale : sales) {
            sale.markSettled(now);
        }
        payments.saveAll(sales);
        settlementPayments.saveAll(sales.stream()
                .map(sale -> SettlementPayment.of(settlement.getId(), sale.getId()))
                .toList());

        publish(KafkaTopics.Events.SETTLEMENT_CREATED, settlement, null);
        metrics.settlementOutcome(SettlementStatus.PENDING);
        log.info("computed settlement {} — {}", settlement.getSettlementNumber(), settlement.describe());
        return Optional.of(settlement);
    }

    /** Marks a payout as done. Idempotent: a retried job finds it already paid. */
    @Transactional
    public MerchantSettlement markPaid(String settlementId, String transactionId) {
        MerchantSettlement settlement = require(settlementId);
        if (settlement.getStatus() == SettlementStatus.PAID) {
            return settlement;
        }
        settlement.markPaid(Instant.now());
        settlements.save(settlement);
        publish(KafkaTopics.Events.SETTLEMENT_PAID, settlement, transactionId);
        metrics.settlementOutcome(SettlementStatus.PAID);
        log.info("paid settlement {} — {} {} to account {}", settlement.getSettlementNumber(),
                settlement.getNetMinor(), settlement.getCurrency(), settlement.getPayoutAccountId());
        return settlement;
    }

    /**
     * Records a failed payout.
     *
     * <p>The settlement stays on the books ({@code FAILED} is not paid) and the job
     * retries it: money that is owed does not stop being owed because a call timed
     * out.
     */
    @Transactional
    public MerchantSettlement markFailed(String settlementId, String reason) {
        MerchantSettlement settlement = require(settlementId);
        if (settlement.getStatus() == SettlementStatus.PAID) {
            return settlement;
        }
        settlement.markFailed(reason);
        settlements.save(settlement);
        publish(KafkaTopics.Events.SETTLEMENT_FAILED, settlement, null);
        metrics.settlementOutcome(SettlementStatus.FAILED);
        log.warn("settlement {} could not be paid: {}", settlement.getSettlementNumber(), reason);
        return settlement;
    }

    /**
     * Points a settlement at the account the merchant has since chosen.
     *
     * <p>Settlement is computed from sales and paid to an account, and those two
     * moments are different: a merchant may configure the account while the payout is
     * already pending, and it must not require a support ticket.
     */
    @Transactional
    public MerchantSettlement assignPayoutAccount(String settlementId, String payoutAccountId) {
        MerchantSettlement settlement = require(settlementId);
        settlement.assignPayoutAccount(payoutAccountId);
        return settlements.save(settlement);
    }

    @Transactional(readOnly = true)
    public MerchantSettlement require(String settlementId) {
        return settlements.findById(settlementId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.SETTLEMENT_NOT_FOUND,
                                "settlement {} not found", settlementId)
                        .withDetail("settlementId", settlementId));
    }

    /**
     * Takes the payout queue.
     *
     * <p>The pessimistic lock that makes this safe for several replicas needs an
     * active transaction, so the selection lives here and not in the orchestrator.
     * It is deliberately a <em>short</em> transaction: the remote payout call happens
     * after it commits, otherwise a slow account service would hold the lock on rows
     * that other replicas are waiting for.
     *
     * <p>The entities are returned detached, which is fine: a settlement has no lazy
     * associations, and every field a payout needs is already loaded.
     */
    @Transactional
    public List<MerchantSettlement> claimPayable(int batchSize) {
        return settlements.findPayable(PageRequest.of(0, batchSize));
    }

    private void publish(String eventType, MerchantSettlement settlement, String transactionId) {
        outboxWriter.append(KafkaTopics.SETTLEMENT_EVENTS, eventType, "MerchantSettlement",
                settlement.getId(), settlement.getVersion(),
                new SettlementEvents.SettlementLifecycle(
                        settlement.getId(),
                        settlement.getSettlementNumber(),
                        settlement.getMerchantId(),
                        settlement.getOwnerUserId(),
                        settlement.getPayoutAccountId(),
                        settlement.getStatus().name(),
                        settlement.getCurrency().name(),
                        settlement.getGrossMinor(),
                        settlement.getCommissionMinor(),
                        settlement.getCustomerPaidMinor(),
                        settlement.getNetMinor(),
                        settlement.getPaymentCount(),
                        transactionId,
                        settlement.getFailureReason(),
                        settlement.getPeriodStart(),
                        settlement.getPeriodEnd(),
                        Instant.now()));
    }
}
