package kz.taxi.trip.domain;

/**
 * What the platform did with the fare reservation of a trip.
 *
 * <p>The trip is the source of truth for the <em>money</em> as well as for the ride,
 * because "was the fare reserved, and did it ever become a real charge" is the first
 * question support asks and the only one that decides whether a cancellation has to
 * release anything. Keeping it as an explicit status instead of inferring it from a
 * non-null {@code holdId} is what makes a crash between the two visible: a trip whose
 * hold is {@code ACTIVE} but whose status is not {@code ASSIGNED} is exactly the
 * state a retry has to resolve before it reserves a second time.
 */
public enum TripHoldStatus {

    /** Nothing reserved: no driver was found, or the request was refused on price. */
    NONE,

    /** The fare is held on the rider's account and money has not moved yet. */
    ACTIVE,

    /** The ride happened and the hold became a real charge. */
    CAPTURED,

    /** The trip ended without a ride and the money went back to the rider. */
    RELEASED
}
