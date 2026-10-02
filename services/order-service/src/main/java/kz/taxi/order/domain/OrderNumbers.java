package kz.taxi.order.domain;

import kz.taxi.common.core.error.Preconditions;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * Order numbers and the idempotency keys derived from them.
 *
 * <p>{@code ORD-250101-00042} reads like a sequence, which is what a customer
 * support call and a bank statement need, and it is unique because the daily
 * counter is taken from the rows that already exist. Two checkouts racing in the
 * same millisecond therefore produce the same candidate number, which is why the
 * caller retries on a unique-violation instead of trusting the counter: the
 * database, not this class, decides who owns a number.
 *
 * <p>The payment keys are derived from the order id on purpose. A checkout that is
 * retried — after a timeout, a redeploy, or a client that never saw the response —
 * must reuse the same key, otherwise the second attempt could charge the customer
 * a second time. The keys are derived from the order id <em>and</em> the merchant
 * id, because an order has one payment per merchant and each of them has to be
 * retried on its own.
 */
public final class OrderNumbers {

    public static final String PREFIX = "ORD-";

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyMMdd");

    private OrderNumbers() {
    }

    /** Builds the readable order number for the {@code sequence}-th order of {@code day}. */
    public static String format(LocalDate day, long sequence) {
        Preconditions.requireNotNull(day, "day must not be null");
        Preconditions.requirePositive(sequence, "sequence");
        return "%s%s-%05d".formatted(PREFIX, DAY.format(day), sequence);
    }

    /**
     * Idempotency key of one merchant's payment.
     *
     * <p>Per merchant, because an order has one payment per seller: the key of the
     * first merchant must not collide with the second, or a retried checkout would
     * replay the first seller's payment for the second seller's goods.
     */
    public static String paymentIdempotencyKey(String orderId, String merchantId) {
        Preconditions.requireText(orderId, "orderId");
        Preconditions.requireText(merchantId, "merchantId");
        return PREFIX + orderId + "-PAY-" + merchantId;
    }

    /** Idempotency key of the refund issued when a captured single-payment order is cancelled. */
    public static String refundIdempotencyKey(String orderId) {
        Preconditions.requireText(orderId, "orderId");
        return PREFIX + orderId + "-REFUND";
    }

    /**
     * Idempotency key of one merchant's refund.
     *
     * <p>Derived from the order id and the merchant id, so a compensation that is
     * retried (a recovery pass, a redelivered event) refunds each merchant once and
     * only once — refunding the same payment twice is giving money away.
     */
    public static String refundIdempotencyKey(String orderId, String merchantId) {
        Preconditions.requireText(orderId, "orderId");
        Preconditions.requireText(merchantId, "merchantId");
        return PREFIX + orderId + "-REFUND-" + merchantId;
    }
}
