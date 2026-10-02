package kz.taxi.order.domain;

/**
 * What a support read was about — the {@code resource_type} of an audit row.
 *
 * <p>A small closed set: a free-form string would make the audit log impossible to
 * query reliably ("was it {@code order} or {@code ORDER}?"), and the audit endpoint
 * filters on exactly these values.
 */
public enum SupportResourceType {

    /** One order, or a page of orders. */
    ORDER,
    /** The status history of one order — the saga's own trail, read by support. */
    ORDER_HISTORY
}
