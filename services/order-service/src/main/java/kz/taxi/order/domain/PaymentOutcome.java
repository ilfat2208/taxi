package kz.taxi.order.domain;

/**
 * What the order service knows about a payment, in its own vocabulary.
 *
 * <p>This is the boundary between the payment service's JSON and the saga: the
 * client maps the wire DTO into this record, and no controller, entity or saga
 * ever sees the payment service's own DTO types. When that service renames a
 * field, exactly one mapper changes.
 *
 * <p>Amounts are per merchant: one of these describes one merchant's share of an
 * order, never the whole basket. {@code amountMinor} is what that merchant is
 * charged, {@code feeMinor} the platform's fee on it (basis points, computed by
 * the payment service) and {@code totalMinor} what the payer is actually debited,
 * which is the sum of the two.
 *
 * @param paymentId     id of the payment, needed to refund it later
 * @param status        COMPLETED, FAILED or UNKNOWN
 * @param amountMinor   what was (or was not) charged for this merchant
 * @param feeMinor      the platform fee the payment service computed on top
 * @param totalMinor    {@code amountMinor + feeMinor}: what left the payer's account
 * @param currency      currency the payment was made in
 * @param failureCode   the payment service's own code when it refused, e.g. {@code INSUFFICIENT_FUNDS}
 * @param failureReason human readable refusal reason
 */
public record PaymentOutcome(String paymentId,
                             String paymentNumber,
                             PaymentStatus status,
                             long amountMinor,
                             long feeMinor,
                             long totalMinor,
                             String currency,
                             String failureCode,
                             String failureReason) {

    public PaymentOutcome {
        status = status == null ? PaymentStatus.UNKNOWN : status;
    }

    /**
     * A payment that carries no platform fee, so its total is its amount.
     *
     * <p>Used where the fee is not part of the question: an outcome built from a
     * refusal, or a reconciliation that only checks the amount that was charged.
     * The fee is the payment service's own number and is never invented here.
     */
    public PaymentOutcome(String paymentId,
                          String paymentNumber,
                          PaymentStatus status,
                          long amountMinor,
                          String currency,
                          String failureCode,
                          String failureReason) {
        this(paymentId, paymentNumber, status, amountMinor, 0L, amountMinor, currency, failureCode, failureReason);
    }

    /** A payment whose outcome we could not learn. */
    public static PaymentOutcome unknown(String paymentId, String reason) {
        return new PaymentOutcome(paymentId, null, PaymentStatus.UNKNOWN, 0L, 0L, 0L, null, null, reason);
    }

    /** A refusal the payment service answered with, rather than a status in a body. */
    public static PaymentOutcome declined(String failureCode, String failureReason) {
        return new PaymentOutcome(null, null, PaymentStatus.FAILED, 0L, 0L, 0L, null, failureCode, failureReason);
    }

    /**
     * True when the payment is for exactly the amount and currency of one merchant's
     * share of the order.
     *
     * <p>Used before a line — and through it the order — is marked paid: a payment
     * for a different amount is a data problem, and guessing which of the two
     * numbers is right is how money gets lost.
     */
    public boolean matches(long expectedAmountMinor, String expectedCurrency) {
        return amountMinor == expectedAmountMinor
                && currency != null
                && expectedCurrency != null
                && currency.equalsIgnoreCase(expectedCurrency);
    }
}
