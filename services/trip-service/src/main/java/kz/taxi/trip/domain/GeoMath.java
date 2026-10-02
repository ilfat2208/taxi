package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;

/**
 * The geometry this service needs: are these two points on Earth, and how far apart
 * are they.
 *
 * <p>Copied from {@code kz.taxi.dispatch.domain.GeoMath} (dispatch-service) rather
 * than shared through a platform module, and the reason is the rule the copy follows:
 * a coordinate is a business input of <em>this</em> service too — a quote for a
 * pickup point in the ocean is a bug in the trip API, and it has to be refused with
 * this service's own error code and status, not with dispatch's. The distance
 * formula, on the other hand, is the same physics, so it is the same code; the
 * dispatch version keeps its accuracy and speed checks, which belong to a GPS
 * reading and have no meaning for an address a rider typed.
 */
public final class GeoMath {

    /** Mean Earth radius (IUGG), in metres. */
    public static final double EARTH_RADIUS_M = 6_371_008.8d;

    private GeoMath() {
    }

    /**
     * Refuses a point that cannot exist on Earth.
     *
     * <p>Checked at the boundary of the quote, because a quote is stored: a bad
     * coordinate that got in would sit in the quote table and be quoted again on
     * every retry of the same request.
     */
    public static void requireValidCoordinates(double lat, double lon, String what) {
        if (Double.isNaN(lat) || Double.isNaN(lon) || lat < -90d || lat > 90d || lon < -180d || lon > 180d) {
            throw DomainException.of(TripErrorCode.INVALID_COORDINATES,
                            "{} coordinates {} {} are outside the valid range", what, lat, lon)
                    .withDetail("point", what)
                    .withDetail("lat", lat)
                    .withDetail("lon", lon);
        }
    }

    /**
     * Great-circle distance in metres, by the haversine formula.
     *
     * <p>Haversine rather than the equirectangular approximation: the difference is
     * invisible over three kilometres in Almaty and the formula is the one every
     * reviewer already knows, so nobody has to re-derive the error term.
     */
    public static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
