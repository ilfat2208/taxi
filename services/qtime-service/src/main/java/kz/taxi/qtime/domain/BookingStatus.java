package kz.taxi.qtime.domain;

/**
 * Where a booking is in its life.
 *
 * <pre>
 *   CONFIRMED --cancel(client)---&gt; CANCELLED_BY_CLIENT
 *   CONFIRMED --cancel(company)--&gt; CANCELLED_BY_COMPANY
 *   CONFIRMED --complete----------&gt; COMPLETED
 *   CONFIRMED --noShow------------&gt; NO_SHOW
 * </pre>
 *
 * <p>Every terminal state is terminal: the diagram has no arrows out of the last
 * four on purpose. Whether a customer did not turn up is a fact about the past, and
 * a status a client could move back to CONFIRMED would let a no-show be erased —
 * which is exactly the number the CRM sells ("неявки" in ORTA Business).
 *
 * <p>Only {@link #CONFIRMED} occupies a window: the partial unique index in the
 * schema is written over this status alone, so cancelling frees the slot without
 * deleting the row.
 */
public enum BookingStatus {

    CONFIRMED,
    CANCELLED_BY_CLIENT,
    CANCELLED_BY_COMPANY,
    COMPLETED,
    /** The client never came. Counted, not punished — yet. */
    NO_SHOW;

    /** True while this booking still occupies its window. */
    public boolean occupiesSlot() {
        return this == CONFIRMED;
    }

    public boolean isCancelled() {
        return this == CANCELLED_BY_CLIENT || this == CANCELLED_BY_COMPANY;
    }
}
