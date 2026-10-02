package kz.taxi.payment.application;

import kz.taxi.common.core.money.Currency;
import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.common.core.money.Money;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentFees;
import kz.taxi.payment.domain.PaymentIntent;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.PaymentType;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import kz.taxi.payment.infrastructure.SettlementPaymentRepository;
import kz.taxi.payment.infrastructure.SettlementRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The reconciliation pass.
 *
 * <p>In a healthy system it finds nothing, so the tests that matter are the ones
 * that feed it a broken record and check that the breakage is named precisely — a
 * reconciliation job that stays quiet when the data is wrong is worse than none,
 * because it creates false confidence.
 */
class PaymentReconciliationServiceTest {

    private static final Instant PERIOD_END = Instant.parse("2024-09-02T00:00:00Z");

    private PaymentRepository payments;
    private RefundRepository refunds;
    private SettlementRepository settlements;
    private SettlementPaymentRepository settlementPayments;
    private PaymentMetrics metrics;
    private PaymentReconciliationService service;

    @BeforeEach
    void setUp() {
        payments = mock(PaymentRepository.class);
        refunds = mock(RefundRepository.class);
        settlements = mock(SettlementRepository.class);
        settlementPayments = mock(SettlementPaymentRepository.class);
        metrics = mock(PaymentMetrics.class);
        service = new PaymentReconciliationService(payments, refunds, settlements, settlementPayments, metrics);

        when(settlements.findAllByOrderByCreatedAtDesc(any(Pageable.class))).thenReturn(Page.empty());
        when(payments.findByStatusOrderByCreatedAtDesc(any(PaymentStatus.class), any(Pageable.class)))
                .thenReturn(Page.empty());
    }

    private MerchantSettlement settlement(int paymentCount, long gross, long commission) {
        return MerchantSettlement.of("M-1", "U-1", "ACC-1", Currency.KZT,
                PERIOD_END.minus(1, ChronoUnit.DAYS), PERIOD_END,
                new MerchantSettlement.PeriodTotals(paymentCount, gross, commission, gross + commission));
    }

    /** A completed merchant payment, built the way the service builds one. */
    private Payment completedPayment(long amountMinor, long feeMinor) {
        PaymentIntent intent = new PaymentIntent(PaymentType.MERCHANT_PAYMENT, "U-1", "ACC-1", null,
                "M-1", "ORDER-1", "reconciliation test", "key-" + amountMinor, "hash-" + amountMinor, null);
        Payment payment = Payment.initiate(intent, new PaymentFees.FeeBreakdown(
                Money.ofMinor(amountMinor, Currency.KZT),
                Money.ofMinor(feeMinor, Currency.KZT),
                Money.ofMinor(amountMinor + feeMinor, Currency.KZT)));
        payment.markPending();
        payment.markCompleted();
        return payment;
    }

    private void givenSettlements(MerchantSettlement... rows) {
        when(settlements.findAllByOrderByCreatedAtDesc(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(rows)));
    }

    private void givenPayments(Payment... rows) {
        when(payments.findByStatusOrderByCreatedAtDesc(eq(PaymentStatus.COMPLETED), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(rows)));
    }

    @Test
    @DisplayName("a healthy system reports no findings and emits no alert metric")
    void reports_nothing_when_data_is_consistent() {
        PaymentReconciliationService.Report report = service.runOnce(100);

        assertThat(report.isClean()).isTrue();
        assertThat(report.findings()).isEmpty();
        verify(metrics, never()).reconciliationFinding(anyString());
    }

    @Test
    @DisplayName("a settlement that claims payments but has no lines is a finding")
    void detects_settlement_without_lines() {
        MerchantSettlement settlement = settlement(2, 100_000, 1_500);
        givenSettlements(settlement);
        when(settlementPayments.countBySettlementId(settlement.getId())).thenReturn(0L);

        PaymentReconciliationService.Report report = service.runOnce(100);

        assertThat(report.findings())
                .singleElement()
                .satisfies(finding -> {
                    assertThat(finding.kind()).isEqualTo("SETTLEMENT_WITHOUT_LINES");
                    assertThat(finding.aggregateId()).isEqualTo(settlement.getId());
                });
        verify(metrics).reconciliationFinding("SETTLEMENT_WITHOUT_LINES");
    }

    @Test
    @DisplayName("a line count that disagrees with the statement is a finding")
    void detects_line_count_mismatch() {
        MerchantSettlement settlement = settlement(3, 150_000, 2_250);
        givenSettlements(settlement);
        when(settlementPayments.countBySettlementId(settlement.getId())).thenReturn(2L);

        PaymentReconciliationService.Report report = service.runOnce(100);

        assertThat(report.findings())
                .singleElement()
                .satisfies(finding -> {
                    assertThat(finding.kind()).isEqualTo("SETTLEMENT_LINE_COUNT_MISMATCH");
                    assertThat(finding.detail()).contains("declares 3").contains("has 2 rows");
                });
    }

    @Test
    @DisplayName("a settlement marked paid without a payout account is a finding")
    void detects_paid_settlement_without_account() {
        MerchantSettlement settlement = MerchantSettlement.of("M-1", "U-1", null, Currency.KZT,
                PERIOD_END.minus(1, ChronoUnit.DAYS), PERIOD_END,
                new MerchantSettlement.PeriodTotals(1, 100_000, 1_500, 101_500));
        settlement.markPaid(PERIOD_END);
        givenSettlements(settlement);
        when(settlementPayments.countBySettlementId(settlement.getId())).thenReturn(1L);

        PaymentReconciliationService.Report report = service.runOnce(100);

        assertThat(report.findings())
                .extracting(PaymentReconciliationService.Finding::kind)
                .contains("SETTLEMENT_PAID_WITHOUT_ACCOUNT");
    }

    @Test
    @DisplayName("refunds summing beyond the payment are a finding")
    void detects_refunds_exceeding_payment() {
        Payment payment = completedPayment(100_000, 1_500);
        givenPayments(payment);
        when(refunds.findByPaymentIdOrderByCreatedAtAsc(payment.getId()))
                .thenReturn(List.of(refund(payment.getId(), 70_000), refund(payment.getId(), 50_000)));

        PaymentReconciliationService.Report report = service.runOnce(100);

        assertThat(report.findings())
                .extracting(PaymentReconciliationService.Finding::kind)
                .contains("REFUNDS_EXCEED_PAYMENT");
        verify(metrics).reconciliationFinding("REFUNDS_EXCEED_PAYMENT");
    }

    @Test
    @DisplayName("refunds within the payment amount are fine")
    void accepts_refunds_within_the_payment() {
        Payment payment = completedPayment(100_000, 1_500);
        givenPayments(payment);
        when(refunds.findByPaymentIdOrderByCreatedAtAsc(payment.getId()))
                .thenReturn(List.of(refund(payment.getId(), 40_000), refund(payment.getId(), 60_000)));

        PaymentReconciliationService.Report report = service.runOnce(100);

        assertThat(report.isClean()).isTrue();
    }

    @Test
    @DisplayName("what is owed is reported as a number an operator can alarm on")
    void reports_outstanding_debt() {
        when(settlements.sumUnpaidNetMinor()).thenReturn(10_936_000L);
        when(settlements.countByStatusNotAndCreatedAtBefore(any(), any(Instant.class))).thenReturn(2L);

        assertThat(service.unpaidNetMinor()).isEqualTo(10_936_000L);
        assertThat(service.overdueCount(1)).isEqualTo(2L);
    }

    private Refund refund(String paymentId, long amountMinor) {
        return Refund.initiate(paymentId, amountMinor, Currency.KZT, "e2e", "key-" + amountMinor);
    }
}
