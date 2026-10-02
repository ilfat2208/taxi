package kz.taxi.catalog.domain;

/**
 * Every support read this service can serve, with the audit fields it writes.
 *
 * <p>The action code and the endpoint template live next to the resource type so a
 * new support endpoint cannot be added without deciding what its audit row will
 * say. Codes are stable API surface for the audit log: they are what an
 * investigation greps for after the fact, so they are never renamed.
 *
 * <p>Naming: {@code <service>.support.<resource>.<verb>}.
 */
public enum SupportAction {

    /** A merchant profile by merchant id. */
    MERCHANT_READ("catalog.support.merchant.read",
            "GET /api/v1/support/merchants/{merchantId}", SupportResourceType.MERCHANT),

    /** A merchant profile resolved from its owner user id — how support starts from a caller. */
    MERCHANT_BY_OWNER("catalog.support.merchant.by-owner",
            "GET /api/v1/support/merchants/by-owner/{ownerUserId}", SupportResourceType.MERCHANT),

    /** The merchant's whole catalog, drafts included. */
    MERCHANT_PRODUCTS("catalog.support.merchant.products",
            "GET /api/v1/support/merchants/{merchantId}/products", SupportResourceType.MERCHANT),

    /** One offer with its status and availability — the "why can this customer not buy?" read. */
    PRODUCT_READ("catalog.support.product.read",
            "GET /api/v1/support/products/{productId}", SupportResourceType.PRODUCT),

    /** The stock counters of one offer, plus the holds that explain them. */
    STOCK_READ("catalog.support.stock.read",
            "GET /api/v1/support/products/{productId}/stock", SupportResourceType.STOCK),

    /** Every stock hold of one checkout. */
    RESERVATIONS_BY_ORDER("catalog.support.reservation.list",
            "GET /api/v1/support/reservations/{orderId}", SupportResourceType.RESERVATION);

    private final String code;
    private final String endpoint;
    private final SupportResourceType resourceType;

    SupportAction(String code, String endpoint, SupportResourceType resourceType) {
        this.code = code;
        this.endpoint = endpoint;
        this.resourceType = resourceType;
    }

    /** Stable, machine-readable action code stored in the audit row. */
    public String code() {
        return code;
    }

    /** HTTP method and path template of the endpoint, for a human reading the log. */
    public String endpoint() {
        return endpoint;
    }

    /** The kind of resource this action reads. */
    public SupportResourceType resourceType() {
        return resourceType;
    }
}
