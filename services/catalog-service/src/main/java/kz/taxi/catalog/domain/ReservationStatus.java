package kz.taxi.catalog.domain;

/** Lifecycle of one {@code (order, product)} stock hold. */
public enum ReservationStatus {

    /** Holding stock: {@code reserved} includes this quantity. */
    ACTIVE,
    /** Paid: the quantity left the warehouse ({@code on_hand} and {@code reserved} both dropped). */
    COMMITTED,
    /** Abandoned or failed: the quantity went back to the sellable pool. */
    RELEASED,
    /** Not paid in time: released by the expiry job, which is a different fact than a release. */
    EXPIRED;

    /** Whether stock is still held by this reservation. */
    public boolean holdsStock() {
        return this == ACTIVE;
    }
}
