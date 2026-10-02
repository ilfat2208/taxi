package kz.taxi.catalog.domain;

/** Lifecycle of a seller account; mirrors the {@code ck_merchant_status} constraint. */
public enum MerchantStatus {

    /** Registered, not yet allowed to sell (verification in progress). */
    PENDING,
    /** Selling normally. */
    ACTIVE,
    /** Temporarily blocked by an operator: products stay visible, checkout is refused. */
    SUSPENDED,
    /** Left the marketplace for good. */
    CLOSED
}
