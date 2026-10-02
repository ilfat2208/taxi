package kz.taxi.catalog.domain;

/**
 * What a support read was about — the {@code resource_type} of an audit row.
 *
 * <p>Deliberately a small closed set: a free-form string would make the audit log
 * impossible to query reliably ("was it {@code product} or {@code PRODUCT}?"), and
 * the audit endpoint filters on exactly these values.
 */
public enum SupportResourceType {

    /** A seller profile. */
    MERCHANT,
    /** A sellable offer, including drafts and archived ones. */
    PRODUCT,
    /** The inventory counters of one product. */
    STOCK,
    /** A stock hold belonging to a checkout. */
    RESERVATION
}
