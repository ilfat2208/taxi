package kz.taxi.payment.domain;

/**
 * Lifecycle of a refund.
 *
 * <p>Only {@code INITIATED} is interesting: it means the refund row exists and is
 * the durable intent to credit the payer, so a process that dies between the row
 * and the credit call can be resumed — the credit is idempotent by
 * {@code (REFUND, refundId)}. The other two states are terminal and are the only
 * ones that count towards the "refunds never exceed the payment" rule.
 */
public enum RefundStatus {

    /** Row committed, the money has not (necessarily) moved yet. */
    INITIATED,

    /** The payer was credited. */
    COMPLETED,

    /** The credit was rejected; it moves nothing and does not block a later refund. */
    FAILED;

    public boolean isTerminal() {
        return this != INITIATED;
    }
}
