package kz.taxi.trip.domain;

/**
 * How far and how long the ride will be, as the quote estimates them.
 *
 * @param distanceM metres along the road
 * @param durationS seconds of the ride, including the time to reach the rider
 */
public record RouteEstimate(int distanceM, int durationS) {

    public RouteEstimate {
        if (distanceM < 0 || durationS < 0) {
            throw new IllegalArgumentException("a route estimate cannot be negative");
        }
    }
}
