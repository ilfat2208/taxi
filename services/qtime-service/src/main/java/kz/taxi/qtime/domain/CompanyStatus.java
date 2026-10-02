package kz.taxi.qtime.domain;

/**
 * Whether a company is still worth showing and booking.
 *
 * <p>{@link #SUSPENDED} is the operator's brake (a salon under review keeps its
 * history and its specialists but takes no new bookings); {@link #ARCHIVED} is the
 * end of the business. Both stay in the database — deleting a company would delete
 * the appointments people made with it, and those are money.
 */
public enum CompanyStatus {
    ACTIVE,
    SUSPENDED,
    ARCHIVED
}
