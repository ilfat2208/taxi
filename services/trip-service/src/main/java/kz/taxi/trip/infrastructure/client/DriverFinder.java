package kz.taxi.trip.infrastructure.client;

import java.util.List;

/**
 * Where the nearest available car is asked for.
 *
 * <p>The finder lives behind an interface because matching is the one part of this
 * service that is expected to be replaced: Ф2 asks dispatch for the nearest free car
 * and takes it, Ф3 will send offers and wait for an accept. The saga only needs
 * "candidates, nearest first", so the day offers arrive, this interface grows a method
 * and nothing else in the ride changes.
 */
public interface DriverFinder {

    /**
     * Available drivers near a point, nearest first.
     *
     * <p>An empty list is a complete and correct answer: it means the city has no free
     * car at that spot, and the trip goes to {@code NO_DRIVERS_FOUND} rather than into
     * an error state. An exception means the question could not be asked at all, which
     * is a different thing and must not be turned into "no cars".
     */
    List<Candidate> nearest(double lat, double lon, int radiusM, int limit);

    /**
     * A driver a trip may be offered to.
     *
     * <p>{@code displayName} comes from the fleet projection in dispatch-service, which
     * learned it from {@code driver.events}: the ride stores the name so a receipt
     * printed next month does not depend on a profile that may have been closed.
     */
    record Candidate(String driverId, String displayName, double distanceM, double lat, double lon, long ageSeconds) {
    }
}
