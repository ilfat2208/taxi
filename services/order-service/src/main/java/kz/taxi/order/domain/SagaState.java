package kz.taxi.order.domain;

/**
 * How far the checkout saga got, persisted next to the order status.
 *
 * <p>The order status alone is not enough to resume a saga: {@code PENDING_PAYMENT}
 * covers three very different situations — stock not reserved yet, stock reserved
 * but payment not sent, and payment sent with an unknown outcome. Each needs a
 * different next call, so the step that was completed is written down before the
 * next remote call is made.
 *
 * <p>Every value is written in its own transaction <em>before</em> the remote call
 * it guards, which is what makes a crash mid-saga recoverable instead of
 * ambiguous.
 */
public enum SagaState {

    /** Order created from the cart; the stock reservation has not been acknowledged. */
    NEW,
    /** Catalog confirmed the reservation; the payment has not been acknowledged. */
    STOCK_RESERVED,
    /** Payment request is on the wire (or was answered with "still processing"). */
    PAYMENT_REQUESTED,
    /** Payment call returned no usable answer (timeout, 5xx): outcome unknown, must be reconciled. */
    PAYMENT_UNKNOWN,
    /** Money captured, stock commit still owed. */
    STOCK_COMMIT_PENDING,
    /** The order is cancelled but the stock hold is still on the merchant's shelf. */
    STOCK_RELEASE_PENDING,
    /** Everything the saga owns is done. */
    COMPLETED,
    /** Compensated: stock released, nothing owed. */
    CANCELLED,
    /** Aborted before any compensation was needed (e.g. catalog rejected the reservation). */
    FAILED
}
