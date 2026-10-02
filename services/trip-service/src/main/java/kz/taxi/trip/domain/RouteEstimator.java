package kz.taxi.trip.domain;

import java.time.Duration;

/**
 * Turns two points into a distance and a duration, until a real router arrives.
 *
 * <p><strong>This is a deliberate approximation.</strong> The distance is the
 * great-circle distance multiplied by a road factor, and the duration is that
 * distance divided by an average city speed plus a fixed pickup allowance. It is not
 * what a navigation service would answer, and it is written down here so nobody
 * discovers it by reading a number that is 30% off:
 *
 * <ul>
 *   <li>a straight line ignores the street grid, the river and the one-way system,
 *       so it is multiplied by a configured factor that is the average detour of a
 *       real route in the pilot city;</li>
 *   <li>a single average speed ignores traffic, time of day and the fact that half
 *       of a ride is spent at traffic lights — the factor that fixes this is a
 *       product decision, not an algorithm, and it lives in configuration;</li>
 *   <li>the pickup allowance exists because the rider is quoted for the whole
 *       experience, not only for the part he sits in the car for.</li>
 * </ul>
 *
 * <p>The replacement is OSRM (or any routing engine), which will return a real
 * distance, a real duration and a real geometry for the same two points. The class
 * exists as a separate object precisely so that swap is one bean's worth of change:
 * the quote and the fare never see a straight line, only a {@link RouteEstimate}.
 */
public final class RouteEstimator {

    private final double roadFactor;
    private final double averageSpeedKph;
    private final Duration pickupTime;

    public RouteEstimator(double roadFactor, double averageSpeedKph, Duration pickupTime) {
        if (roadFactor < 1d) {
            throw new IllegalArgumentException("roadFactor must be at least 1 (a road is never shorter than a line)");
        }
        if (averageSpeedKph <= 0d) {
            throw new IllegalArgumentException("averageSpeedKph must be positive");
        }
        if (pickupTime == null || pickupTime.isNegative()) {
            throw new IllegalArgumentException("pickupTime must not be negative");
        }
        this.roadFactor = roadFactor;
        this.averageSpeedKph = averageSpeedKph;
        this.pickupTime = pickupTime;
    }

    /**
     * Estimates the ride between two points.
     *
     * <p>The rounding is up, on both numbers: a quote must not promise a distance or
     * a duration the ride cannot beat, and an integer estimate is what the fare
     * calculator is allowed to multiply by.
     */
    public RouteEstimate estimate(double pickupLat, double pickupLon,
                                  double dropoffLat, double dropoffLon) {
        GeoMath.requireValidCoordinates(pickupLat, pickupLon, "pickup");
        GeoMath.requireValidCoordinates(dropoffLat, dropoffLon, "dropoff");

        double straightLineM = GeoMath.haversineMeters(pickupLat, pickupLon, dropoffLat, dropoffLon);
        int distanceM = (int) Math.ceil(straightLineM * roadFactor);

        double metresPerSecond = averageSpeedKph * 1000d / 3600d;
        int travelS = (int) Math.ceil(distanceM / metresPerSecond);
        int durationS = travelS + (int) pickupTime.toSeconds();

        return new RouteEstimate(distanceM, durationS);
    }
}
