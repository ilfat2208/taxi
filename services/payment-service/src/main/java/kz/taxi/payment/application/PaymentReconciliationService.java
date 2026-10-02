package kz.taxi.payment.application;

import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.domain.SettlementStatus;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import kz.taxi.payment.infrastructure.SettlementPaymentRepository;
import kz.taxi.payment.infrastructure.SettlementRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Reconciliation: proves that what the service believes about money matches what it
 * actually recorded.
 *
 * <p>Every invariant in this class is already enforced by the code and by database
 * constraints, so in normal operation it finds nothing — and that is the point. The
 * job exists for the day the code is wrong, a migration is wrong, or somebody edits
 * rows by hand: it turns "we think a merchant was overpaid" into an alert with the
 * settlement number attached, hours before a person notices.
 *
 * <p>What it deliberately does <em>not</em> do: query other services. A payout's
 * ledger transaction lives in account-service, and reaching for it here would make a
 * reconciliation job the most fragile component in the system. Cross-service proof is
 * the ledger reference ({@code SETTLEMENT/<id>}) and the account service's own
 * idempotency; this job checks the half of the story payment-service owns.
 *
 * <p>Findings are reported, never auto-corrected. Silently "fixing" money is how a
 * small inconsistency becomes an unexplained large one; every finding names the
 * aggregate so a human can decide.
 */
@Service
@Slf4j
public class PaymentReconciliationService {

    /** What a run looked like; returned for logs, metrics and tests. */
    public record Report(int paymentsChecked, int settlementsChecked, List<Finding> findings) {

        public boolean isClean() {
            return findings.isEmpty();
        }
    }

    /** One inconsistency, with enough context to act on it. */
    public record Finding(String kind, String aggregateType, String aggregateId, String detail) {
    }

    private final PaymentRepository payments;
    private final RefundRepository refunds;
    private final SettlementRepository settlements;
    private final SettlementPaymentRepository settlementPayments;
    private final PaymentMetrics metrics;

    public PaymentReconciliationService(PaymentRepository payments,
                                        RefundRepository refunds,
                                        SettlementRepository settlements,
                                        SettlementPaymentRepository settlementPayments,
                                        PaymentMetrics metrics) {
        this.payments = payments;
        this.refunds = refunds;
        this.settlements = settlements;
        this.settlementPayments = settlementPayments;
        this.metrics = metrics;
    }

    @Transactional(readOnly = true)
    public Report runOnce(int batchSize) {
        List<Finding> findings = new ArrayList<>();
        PageRequest page = PageRequest.of(0, batchSize);

        List<MerchantSettlement> recentSettlements = settlements
                .findAllByOrderByCreatedAtDesc(page).getContent();
        for (MerchantSettlement settlement : recentSettlements) {
            checkSettlement(settlement, findings);
        }

        List<Payment> completed = payments.findByStatusOrderByCreatedAtDesc(PaymentStatus.COMPLETED, page).getContent();
        for (Payment payment : completed) {
            checkPaymentArithmetic(payment, findings);
            checkRefunds(payment, findings);
        }

        Report report = new Report(completed.size(), recentSettlements.size(), List.copyOf(findings));
        if (report.isClean()) {
            log.debug("reconciliation found nothing: {} payments, {} settlements checked",
                    report.paymentsChecked(), report.settlementsChecked());
        } else {
            findings.forEach(finding -> {
                metrics.reconciliationFinding(finding.kind());
                log.error("reconciliation finding [{}] {}/{}: {}", finding.kind(),
                        finding.aggregateType(), finding.aggregateId(), finding.detail());
            });
        }
        return report;
    }

    /**
     * A settlement must be backed by the payments it claims, and its arithmetic must
     * hold. The line count is compared against {@code paymentCount} because that is
     * the field a merchant statement shows.
     */
    private void checkSettlement(MerchantSettlement settlement, List<Finding> findings) {
        long lines = settlementPayments.countBySettlementId(settlement.getId());
        if (lines == 0) {
            findings.add(new Finding("SETTLEMENT_WITHOUT_LINES", "MerchantSettlement", settlement.getId(),
                    "settlement %s covers %d payments but has no settlement_payment rows"
                            .formatted(settlement.getSettlementNumber(), settlement.getPaymentCount())));
        } else if (lines != settlement.getPaymentCount()) {
            findings.add(new Finding("SETTLEMENT_LINE_COUNT_MISMATCH", "MerchantSettlement", settlement.getId(),
                    "settlement %s declares %d payments but has %d rows"
                            .formatted(settlement.getSettlementNumber(), settlement.getPaymentCount(), lines)));
        }

        if (settlement.getNetMinor() != settlement.getGrossMinor()) {
            findings.add(new Finding("SETTLEMENT_NET_NOT_GROSS", "MerchantSettlement", settlement.getId(),
                    "net %d != gross %d".formatted(settlement.getNetMinor(), settlement.getGrossMinor())));
        }
        if (settlement.getCustomerPaidMinor() != settlement.getGrossMinor() + settlement.getCommissionMinor()) {
            findings.add(new Finding("SETTLEMENT_PAID_MISMATCH", "MerchantSettlement", settlement.getId(),
                    "customer paid %d != gross %d + commission %d".formatted(
                            settlement.getCustomerPaidMinor(), settlement.getGrossMinor(),
                            settlement.getCommissionMinor())));
        }
        if (settlement.getStatus() == SettlementStatus.PAID && !settlement.hasPayoutAccount()) {
            findings.add(new Finding("SETTLEMENT_PAID_WITHOUT_ACCOUNT", "MerchantSettlement", settlement.getId(),
                    "settlement %s is PAID but records no payout account"
                            .formatted(settlement.getSettlementNumber())));
        }
    }

    /** total = amount + fee, and a completed payment must know when it completed. */
    private void checkPaymentArithmetic(Payment payment, List<Finding> findings) {
        if (payment.getTotalMinor() != payment.getAmountMinor() + payment.getFeeMinor()) {
            findings.add(new Finding("PAYMENT_TOTAL_MISMATCH", "Payment", payment.getId(),
                    "total %d != amount %d + fee %d".formatted(
                            payment.getTotalMinor(), payment.getAmountMinor(), payment.getFeeMinor())));
        }
        if (payment.getCompletedAt() == null) {
            findings.add(new Finding("PAYMENT_COMPLETED_WITHOUT_TIMESTAMP", "Payment", payment.getId(),
                    "payment %s is COMPLETED but has no completed_at".formatted(payment.getPaymentNumber())));
        }
        if (payment.getAmountMinor() <= 0) {
            findings.add(new Finding("PAYMENT_NON_POSITIVE_AMOUNT", "Payment", payment.getId(),
                    "amount %d".formatted(payment.getAmountMinor())));
        }
    }

    /**
     * Refunds may never exceed what was charged.
     *
     * <p>Checked per payment because that is the unit a customer disputes; the sum is
     * compared against the payment amount, not against each refund.
     */
    private void checkRefunds(Payment payment, List<Finding> findings) {
        List<Refund> refundsOfPayment = refunds.findByPaymentIdOrderByCreatedAtAsc(payment.getId());
        long refunded = 0;
        for (Refund refund : refundsOfPayment) {
            if (refund.getStatus() == kz.taxi.payment.domain.RefundStatus.FAILED) {
                continue;
            }
            refunded += refund.getAmountMinor();
        }
        if (refunded > payment.getAmountMinor()) {
            findings.add(new Finding("REFUNDS_EXCEED_PAYMENT", "Payment", payment.getId(),
                    "refunded %d of a %d payment (%s)".formatted(
                            refunded, payment.getAmountMinor(), payment.getPaymentNumber())));
        }
    }

    /** How much is owed, and for how long — the operational half of the same question. */
    @Transactional(readOnly = true)
    public long unpaidNetMinor() {
        return settlements.sumUnpaidNetMinor();
    }

    @Transactional(readOnly = true)
    public long overdueCount(int olderThanDays) {
        return settlements.countByStatusNotAndCreatedAtBefore(kz.taxi.payment.domain.SettlementStatus.PAID, Instant.now().minus(olderThanDays, java.time.temporal.ChronoUnit.DAYS));
    }
}
