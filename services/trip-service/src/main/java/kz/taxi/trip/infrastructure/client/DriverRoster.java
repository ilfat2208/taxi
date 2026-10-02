package kz.taxi.trip.infrastructure.client;

/**
 * The driver's own record of which trip he is on.
 *
 * <p>A separate contract from {@link DriverFinder} because it belongs to a different
 * service and answers a different kind of question: the finder asks dispatch
 * <em>who is free</em> (a projection, rebuilt from events), while this one tells
 * driver-service <em>you have a trip</em> (the authoritative fact, enforced by the
 * aggregate that also refuses to let a busy driver go off duty). Both are needed: a
 * claim that only existed in dispatch's projection would be forgotten the next time
 * the projection was rebuilt.
 *
 * <p>Both operations are idempotent in the direction the saga needs. Claiming a trip
 * that is already claimed by the same trip id is the desired state; releasing a driver
 * who has no trip means he was already released.
 */
public interface DriverRoster {

    /**
     * Claims the driver for a trip: he becomes BUSY and stops being offered to anybody.
     *
     * @throws kz.taxi.common.core.error.DomainException {@code DRIVER_NOT_AVAILABLE}
     *         when he is off duty or already carrying somebody — a normal answer during
     *         a search, and the reason the search tries the next candidate
     */
    DriverView assignTrip(String driverId, String tripId);

    /** Releases the driver after the ride; he returns to duty, not offline. */
    DriverView finishTrip(String driverId);

    record DriverView(String driverId, String displayName, String status, String currentTripId, boolean available) {
    }
}
