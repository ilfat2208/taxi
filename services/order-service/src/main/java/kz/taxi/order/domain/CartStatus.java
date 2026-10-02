package kz.taxi.order.domain;

/**
 * Lifecycle of a cart.
 *
 * <p>Only {@code ACTIVE} carts are editable and only one cart per user may be
 * active at a time (enforced by a partial unique index in the database, not by
 * application code alone). A checked-out cart is kept as history instead of being
 * deleted, so support can answer "what exactly did the customer put in the cart".
 */
public enum CartStatus {

    ACTIVE,
    CHECKED_OUT,
    ABANDONED
}
