package kz.taxi.order.domain;

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

    /** One order with its lines and its history. */
    ORDER_READ("order.support.order.read",
            "GET /api/v1/support/orders/{orderId}", SupportResourceType.ORDER),

    /** One order found by the number the customer quotes on the phone. */
    ORDER_BY_NUMBER("order.support.order.by-number",
            "GET /api/v1/support/orders/by-number/{orderNumber}", SupportResourceType.ORDER),

    /** Orders by user id and/or status — starting from a person, not from an id. */
    ORDER_LIST("order.support.order.list",
            "GET /api/v1/support/orders", SupportResourceType.ORDER),

    /** The saga trail of one order: every transition, its actor and its reason. */
    ORDER_HISTORY_READ("order.support.order-history.read",
            "GET /api/v1/support/orders/{orderId}/history", SupportResourceType.ORDER_HISTORY);

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
