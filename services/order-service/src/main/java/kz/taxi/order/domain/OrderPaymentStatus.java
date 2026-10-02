package kz.taxi.order.domain;

/**
 * How far one merchant's payment of an order got.
 *
 * <p>Per-merchant, not per-order: a checkout that charges three merchants has
 * three of these, and "the order is paid" is a statement about all of them. The
 * set is exactly what the database CHECK constraint allows, so a value that
 * cannot be stored cannot be produced either.
 */
public enum OrderPaymentStatus {

    /** The payment has been (or is about to be) requested; its outcome is not known yet. */
    PENDING,
    /** The merchant was paid: the money moved. */
    COMPLETED,
    /** The payment service refused this merchant's payment; nothing moved. */
    FAILED,
    /** The money was given back, because another merchant of the same order refused. */
    REFUNDED;

    public boolean isPending() {
        return this == PENDING;
    }

    public boolean isCompleted() {
        return this == COMPLETED;
    }

    public boolean isFailed() {
        return this == FAILED;
    }

    public boolean isRefunded() {
        return this == REFUNDED;
    }

    /** True when no further answer can change this line: it is done, one way or another. */
    public boolean isSettled() {
        return this != PENDING;
    }
}
