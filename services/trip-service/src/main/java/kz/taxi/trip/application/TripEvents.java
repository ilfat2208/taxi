package kz.taxi.trip.application;

import java.time.Instant;

/**
 * Payloads of the events this service publishes on {@code trip.events}.
 *
 * <p>Only the event types that already exist in {@code KafkaTopics.Events} are used —
 * {@code trip.requested}, {@code trip.driver.assigned}, {@code trip.driver.arrived},
 * {@code trip.started}, {@code trip.completed}, {@code trip.cancelled} — and every one
 * of them carries the trip id, because that is the Kafka key and therefore the thing
 * that keeps one ride's events in order.
 *
 * <p>The payloads are deliberately flat and contain no entities: a consumer is a
 * different service with a different schema, and what it needs is the facts of the
 * ride (who, where, how much), not the shape of this service's tables. Everyone who
 * needs the current state can ask for it; the event says what changed.
 *
 * <p>A rating publishes nothing: no such event type exists, and a rating is not a fact
 * another service has to react to. It is recorded as a transition row and is visible
 * through the API.
 */
public final class TripEvents {

    private TripEvents() {
    }

    /** A rider asked for a ride; the search has started. */
    public record TripRequested(String tripId,
                                String tripNumber,
                                String riderUserId,
                                String tariff,
                                double pickupLat,
                                double pickupLon,
                                String pickupAddress,
                                double dropoffLat,
                                double dropoffLon,
                                String dropoffAddress,
                                int distanceM,
                                int durationS,
                                long priceMinor,
                                int commissionBp,
                                long commissionMinor,
                                long driverNetMinor,
                                int surgeBp,
                                String currency,
                                Instant requestedAt) {
    }

    /** A car is on its way; the fare is reserved on the rider's account. */
    public record TripDriverAssigned(String tripId,
                                     String tripNumber,
                                     String riderUserId,
                                     String driverId,
                                     String driverName,
                                     String currency,
                                     long priceMinor,
                                     String holdId,
                                     Instant assignedAt) {
    }

    /** The car is at the pickup point. */
    public record TripDriverArrived(String tripId,
                                    String tripNumber,
                                    String driverId,
                                    Instant arrivedAt) {
    }

    /** The rider is in the car; from here the fare is owed. */
    public record TripStarted(String tripId,
                              String tripNumber,
                              String driverId,
                              Instant startedAt) {
    }

    /**
     * The ride happened and the money moved.
     *
     * <p>{@code driverNetMinor} is published even though nobody is paid yet: it is the
     * number the future payout flow will consume, and a consumer that has to recompute
     * it from a commission rate that may have changed since is a consumer that will one
     * day pay the wrong amount.
     */
    public record TripCompleted(String tripId,
                                String tripNumber,
                                String riderUserId,
                                String driverId,
                                int distanceM,
                                int durationS,
                                long priceMinor,
                                int commissionBp,
                                long commissionMinor,
                                long driverNetMinor,
                                String currency,
                                String holdId,
                                String transactionId,
                                Instant completedAt) {
    }

    /**
     * The ride will not happen.
     *
     * <p>Used for cancellations by both sides <em>and</em> for
     * {@code NO_DRIVERS_FOUND}: from the outside, all three mean "this request is over,
     * no money is committed", and giving the last one its own event type would mean
     * introducing a name that does not exist in the platform's catalogue. The
     * distinction survives in {@code status} and {@code reason}.
     *
     * <p>{@code holdReleased} is conservative by construction: it is written in the same
     * transaction as the status change, and the fare is released right after that
     * transaction commits — because the aggregate, not the money, is what decides whether
     * closing the ride is lawful. {@code false} therefore means "the reservation was not
     * known to be released yet", never "the rider was charged": the authoritative answer
     * is the trip's own {@code holdStatus}, and the account service publishes
     * {@code account.hold.released} when the money actually moves.
     */
    public record TripCancelled(String tripId,
                                String tripNumber,
                                String riderUserId,
                                String status,
                                String reason,
                                String actor,
                                boolean holdReleased,
                                Instant cancelledAt) {
    }
}
