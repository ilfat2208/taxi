package kz.taxi.trip.application;

import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripReceipt;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;

import java.util.List;

/**
 * A trip and its history, as the API layers read it.
 *
 * <p>The entity is intentionally passed around inside the service rather than copied
 * into a transport record at this boundary: the receipt has to be built from the exact
 * same object that the timeline was read for, and a second copy of the ride is a second
 * place for the two to disagree.
 *
 * <p>{@link #receipt()} is the single implementation behind both ways of asking for a
 * check: it is what {@code GET /trips/{id}/receipt} returns, and what
 * {@code GET /trips/{id}} embeds for a completed ride. There is no second code path
 * that could produce a different receipt for the same ride.
 */
public record TripDetails(Trip trip, List<TripTransition> timeline) {

    public TripDetails {
        timeline = List.copyOf(timeline);
    }

    public String tripId() {
        return trip.getId();
    }

    /** The receipt of a completed ride, or {@code null} while it is still moving. */
    public TripReceipt receiptOrNull() {
        return trip.getStatus() == TripStatus.COMPLETED ? TripReceipt.of(trip) : null;
    }

    /**
     * The receipt, or a refusal.
     *
     * <p>409 and not 404: the ride exists, it simply has not happened yet, and a client
     * that shows "чек не найден" for a ride in progress would be describing the wrong
     * problem.
     */
    public TripReceipt receipt() {
        return TripReceipt.of(trip);
    }
}
