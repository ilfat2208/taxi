package kz.taxi.order.domain;

import kz.taxi.common.core.money.Currency;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * One merchant's payment line, and the invariants the database also enforces.
 *
 * <p>{@code order_payment} carries CHECK constraints for the same facts tested here
 * ({@code total = amount + fee}, a positive amount, a non-negative fee). The reason
 * to test them in Java as well is that a violating row would only be discovered when
 * the transaction is flushed, which on a money path is too late to be useful.
 */
class OrderPaymentTest {

    private static final String ORDER_ID = "order-1";
    private static final String MERCHANT_ID = "merchant-1";

    @Test
    @DisplayName("a line is written before the charge, with no fee invented and a total equal to the amount")
    void pendingLineCarriesNoFeeYet() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 10_500L, Currency.KZT);

        assertThat(line.getStatus()).isEqualTo(OrderPaymentStatus.PENDING);
        assertThat(line.getAmountMinor()).isEqualTo(10_500L);
        assertThat(line.getFeeMinor()).isZero();
        assertThat(line.getTotalMinor()).isEqualTo(10_500L);
        assertThat(line.getPaymentId()).isNull();
        assertThat(line.currencyCode()).isEqualTo("KZT");
    }

    @Test
    @DisplayName("a charge of nothing is refused: an amount the database would reject is not built")
    void refusesANonPositiveAmount() {
        assertThatThrownBy(() -> OrderPayment.pending(ORDER_ID, MERCHANT_ID, 0L, Currency.KZT))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("the platform fee of a completed payment is recorded on top of the amount")
    void completedLineCarriesThePlatformFee() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 10_000L, Currency.KZT);

        line.markCompleted(new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.COMPLETED, 10_000L,
                250L, 10_250L, "KZT", null, null));

        assertThat(line.getStatus()).isEqualTo(OrderPaymentStatus.COMPLETED);
        assertThat(line.getPaymentId()).isEqualTo("payment-1");
        assertThat(line.getFeeMinor()).isEqualTo(250L);
        // The invariant the CHECK constraint enforces, proven to hold before the flush.
        assertThat(line.getTotalMinor()).isEqualTo(line.getAmountMinor() + line.getFeeMinor());
    }

    @Test
    @DisplayName("a redelivered completion does not move the line a second time")
    void completionIsIdempotent() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 10_000L, Currency.KZT);
        line.markCompleted(new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.COMPLETED, 10_000L, 250L,
                10_250L, "KZT", null, null));

        line.markCompleted(new PaymentOutcome("payment-2", "PAY-2", PaymentStatus.COMPLETED, 10_000L, 999L,
                10_999L, "KZT", null, null));

        assertThat(line.getPaymentId()).isEqualTo("payment-1");
        assertThat(line.getFeeMinor()).isEqualTo(250L);
    }

    @Test
    @DisplayName("a refusal is recorded with its code and reason, truncated to the columns")
    void refusalIsRecordedAndTruncated() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 5_000L, Currency.KZT);

        line.markFailed(new PaymentOutcome(null, null, PaymentStatus.FAILED, 0L, 0L, 0L, "KZT",
                "C".repeat(80), "r".repeat(600)));

        assertThat(line.getStatus()).isEqualTo(OrderPaymentStatus.FAILED);
        assertThat(line.getFailureCode()).hasSize(64);
        assertThat(line.getFailureReason()).hasSize(512);
        // Nothing moved, so nothing was added on top of the amount.
        assertThat(line.getTotalMinor()).isEqualTo(line.getAmountMinor());
    }

    @Test
    @DisplayName("a refunded line owes nothing, and refunding twice changes nothing")
    void refundIsIdempotent() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 5_000L, Currency.KZT);
        line.markCompleted(new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.COMPLETED, 5_000L, 0L,
                5_000L, "KZT", null, null));

        line.markRefunded();
        line.markRefunded();

        assertThat(line.getStatus()).isEqualTo(OrderPaymentStatus.REFUNDED);
        assertThat(line.asOutcome().status()).isEqualTo(PaymentStatus.UNKNOWN);
    }

    @Test
    @DisplayName("an unsettled line reports an unknown outcome, never a paid one")
    void unsettledLineIsUnknown() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 5_000L, Currency.KZT);

        assertThat(line.asOutcome().status()).isEqualTo(PaymentStatus.UNKNOWN);
        assertThat(line.asOutcome().amountMinor()).isEqualTo(5_000L);

        line.markFailed(new PaymentOutcome(null, null, PaymentStatus.FAILED, 0L, 0L, 0L, "KZT",
                "INSUFFICIENT_FUNDS", "insufficient funds"));

        assertThat(line.asOutcome().status()).isEqualTo(PaymentStatus.FAILED);
    }

    @Test
    @DisplayName("a payment is only trusted for the line's own amount and currency")
    void matchesOnlyItsOwnAmount() {
        OrderPayment line = OrderPayment.pending(ORDER_ID, MERCHANT_ID, 5_000L, Currency.KZT);

        assertThat(line.matches(new PaymentOutcome("p", "PAY", PaymentStatus.COMPLETED, 5_000L, 0L, 5_000L,
                "KZT", null, null))).isTrue();
        assertThat(line.matches(new PaymentOutcome("p", "PAY", PaymentStatus.COMPLETED, 4_999L, 0L, 4_999L,
                "KZT", null, null))).isFalse();
        assertThat(line.matches(new PaymentOutcome("p", "PAY", PaymentStatus.COMPLETED, 5_000L, 0L, 5_000L,
                "USD", null, null))).isFalse();
    }
}
