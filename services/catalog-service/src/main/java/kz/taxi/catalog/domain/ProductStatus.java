package kz.taxi.catalog.domain;

/** Lifecycle of an offer; mirrors the {@code ck_product_status} constraint. */
public enum ProductStatus {

    /** Created by the merchant but not published to the catalog. */
    DRAFT,
    /** Visible and buyable. */
    ACTIVE,
    /** Visible, but the merchant marked it as temporarily unavailable. */
    OUT_OF_STOCK,
    /** Withdrawn: never returned by public reads and never reservable. */
    ARCHIVED;

    /** Whether a checkout may reserve stock for a product in this status. */
    public boolean sellable() {
        return this == ACTIVE || this == OUT_OF_STOCK;
    }

    /** Whether the status is visible in the public catalog. */
    public boolean publiclyVisible() {
        return this != ARCHIVED;
    }
}
