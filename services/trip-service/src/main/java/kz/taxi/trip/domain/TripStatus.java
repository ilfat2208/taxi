package kz.taxi.trip.domain;

import java.util.Set;

/**
 * Where a trip is in its life.
 *
 * <pre>
 *   SEARCHING --assign----&gt; ASSIGNED --arrive--&gt; ARRIVED --start--&gt; IN_PROGRESS --complete--&gt; COMPLETED
 *       |                       |                   |
 *       |                       |                   +--cancel--&gt; CANCELLED_BY_*
 *       +--cancel---------------+
 *       |
 *       +--no candidate--&gt; NO_DRIVERS_FOUND
 * </pre>
 *
 * <p>The enum is the state machine, not a label: {@link #canMoveTo} is the single
 * description of which moves exist, and the aggregate refuses everything else. Two
 * product rules are encoded here rather than in a service, because both of them
 * decide when money moves:
 *
 * <ul>
 *   <li><em>Forward only.</em> There is no way back to {@code SEARCHING}: a rider
 *       whose car was taken away by an incident gets a new trip, not a resurrected
 *       one, otherwise the hold and the events of the first attempt would have to be
 *       undone rather than compensated.</li>
 *   <li><em>No cancellation once the rider is in the car.</em> After
 *       {@code IN_PROGRESS} the fare is owed: the only way out is
 *       {@code COMPLETED}, and an incident is handled as support, not as a state
 *       transition.</li>
 * </ul>
 */
public enum TripStatus {

    /** The request is accepted and the platform is looking for a car. */
    SEARCHING,

    /** A driver is claimed and the fare is reserved on the rider's account. */
    ASSIGNED,

    /** The car is at the pickup point. */
    ARRIVED,

    /** The rider is in the car; the meter is running. */
    IN_PROGRESS,

    /** The ride happened. This is the only status in which the fare is captured. */
    COMPLETED,

    /** The rider (or an operator acting for him) called it off. His hold is released. */
    CANCELLED_BY_RIDER,

    /** The driver side could not perform: a breakdown, a no-show. Same money rule. */
    CANCELLED_BY_DRIVER,

    /**
     * Nobody was available. Deliberately a normal outcome and not an error: the
     * honest answer to "give me a car" in a city with no free cars is "there is
     * none", and it must reach the rider as a trip he can see rather than as a
     * failure he has to guess about.
     */
    NO_DRIVERS_FOUND;

    /** Statuses from which nothing else happens: no move, no money. */
    private static final Set<TripStatus> TERMINAL =
            Set.of(COMPLETED, CANCELLED_BY_RIDER, CANCELLED_BY_DRIVER, NO_DRIVERS_FOUND);

    /**
     * Statuses of a ride that is still happening — the dispatcher's board.
     *
     * <p>Not "everything that is not terminal by cancellation": a completed ride is over
     * as much as a cancelled one, and a board that showed yesterday's finished rides
     * would be a report, not a board.
     */
    private static final Set<TripStatus> LIVE =
            Set.of(SEARCHING, ASSIGNED, ARRIVED, IN_PROGRESS);

    /** The live statuses, for the dispatcher's default filter. */
    public static Set<TripStatus> live() {
        return LIVE;
    }

    /** True when this status will never change again. */
    public boolean isTerminal() {
        return TERMINAL.contains(this);
    }

    /** True when the trip ended without being performed. */
    public boolean isCancelled() {
        return this == CANCELLED_BY_RIDER || this == CANCELLED_BY_DRIVER;
    }

    /** True when a driver is on the trip: dispatch, the app and support all ask this. */
    public boolean hasDriver() {
        return this == ASSIGNED || this == ARRIVED || this == IN_PROGRESS || this == COMPLETED;
    }

    /**
     * True while a cancellation is still possible.
     *
     * <p>Exactly the pre-ride statuses: {@code SEARCHING} (nobody claimed it yet),
     * {@code ASSIGNED} and {@code ARRIVED} (the car is on its way or waiting).
     */
    public boolean isCancellable() {
        return this == SEARCHING || this == ASSIGNED || this == ARRIVED;
    }

    /** A rating belongs to a performed trip only; a cancelled one is not rated. */
    public boolean isRateable() {
        return this == COMPLETED;
    }

    /**
     * The whole transition table of the service, in one place.
     *
     * <p>Written as an exhaustive {@code switch} on purpose: adding a status to the
     * enum without deciding how it may be reached becomes a compile error rather
     * than a silent hole in the state machine.
     */
    public boolean canMoveTo(TripStatus target) {
        if (target == null || target == this) {
            return false;
        }
        return switch (this) {
            case SEARCHING -> target == ASSIGNED || target == NO_DRIVERS_FOUND
                    || target == CANCELLED_BY_RIDER || target == CANCELLED_BY_DRIVER;
            case ASSIGNED -> target == ARRIVED
                    || target == CANCELLED_BY_RIDER || target == CANCELLED_BY_DRIVER;
            case ARRIVED -> target == IN_PROGRESS
                    || target == CANCELLED_BY_RIDER || target == CANCELLED_BY_DRIVER;
            case IN_PROGRESS -> target == COMPLETED;
            case COMPLETED, CANCELLED_BY_RIDER, CANCELLED_BY_DRIVER, NO_DRIVERS_FOUND -> false;
        };
    }

    /** The cancellation status that matches the party that called the trip off. */
    public static TripStatus cancelledBy(boolean byRider) {
        return byRider ? CANCELLED_BY_RIDER : CANCELLED_BY_DRIVER;
    }
}
