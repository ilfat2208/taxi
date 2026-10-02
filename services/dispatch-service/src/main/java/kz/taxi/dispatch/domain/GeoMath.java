package kz.taxi.dispatch.domain;

import kz.taxi.common.core.error.DomainException;

import java.time.Duration;
import java.time.Instant;

/**
 * The little geometry this service needs, kept out of the storage classes.
 *
 * <p>Distances on the hot path come from Redis (it indexes positions and returns
 * the distance with them). This class exists for the two things Redis does not do:
 * validate what a driver sent, and decide whether a position is still trustworthy.
 *
 * <p>Validation is about <em>possibility</em>, not about plausibility: a coordinate
 * that cannot exist on Earth, an accuracy no device can report, a speed no city car
 * reaches. A driver in the ocean is a valid position that is simply far away and
 * never a candidate — catching a missing GPS fix is the client's job (it reports a
 * huge accuracy, which is what {@link #MAX_ACCURACY_M} refuses).
 */
public final class GeoMath {

    /** Below this, a "position" is a device that has not got a fix yet. */
    public static final double MIN_ACCURACY_M = 0d;
    /** Above this, the reading is too coarse to route a car by. */
    public static final double MAX_ACCURACY_M = 5_000d;
    /** No wheeled vehicle in a city moves faster than this; above it, positions are spoofed. */
    public static final double MAX_SPEED_KPH = 250d;

    private GeoMath() {
    }

    /**
     * Refuses a position that would poison the fleet view.
     *
     * <p>Checked here rather than in the controller because the same rule must
     * hold for a single point and for a batch, and because a bad coordinate is a
     * business failure (a garbage row in the index), not a parsing problem.
     */
    public static void requireValid(double lat, double lon, double accuracyM, double speedKph) {
        if (Double.isNaN(lat) || Double.isNaN(lon) || lat < -90d || lat > 90d || lon < -180d || lon > 180d) {
            throw DomainException.of(DispatchErrorCode.INVALID_POSITION,
                            "coordinates {} {} are outside the valid range", lat, lon)
                    .withDetail("lat", lat)
                    .withDetail("lon", lon);
        }
        if (accuracyM < MIN_ACCURACY_M || accuracyM > MAX_ACCURACY_M) {
            throw DomainException.of(DispatchErrorCode.INVALID_POSITION,
                            "accuracy {} m is not usable", accuracyM)
                    .withDetail("accuracyM", accuracyM);
        }
        if (speedKph < 0d || speedKph > MAX_SPEED_KPH) {
            throw DomainException.of(DispatchErrorCode.INVALID_POSITION,
                            "speed {} km/h is not plausible", speedKph)
                    .withDetail("speedKph", speedKph);
        }
    }

    /** True when the reading is older than the tolerance dispatch trusts. */
    public static boolean isStale(Instant at, Instant now, Duration tolerance) {
        return at == null || Duration.between(at, now).compareTo(tolerance) > 0;
    }

    /**
     * Great-circle distance in metres.
     *
     * <p>Not used to rank candidates — that happens in Redis, where the index
     * already knows the distances. It is used to reason in tests and to explain a
     * candidate list in logs without a round trip.
     */
    public static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double earthRadiusM = 6_371_008.8d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
