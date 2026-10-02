package kz.taxi.dispatch.domain;

import java.time.Instant;

/**
 * One sample of where a driver was.
 *
 * <p>{@code at} is the moment the device took the reading, not the moment the
 * server stored it: a batch that arrives late (the phone was offline, the tunnel
 * ate the signal) must not look like a fresh position, or dispatch would offer a
 * trip to a driver who has since driven across town.
 *
 * @param lat        latitude in degrees
 * @param lon        longitude in degrees
 * @param headingDeg direction of travel in degrees (0 = north); 0 when unknown
 * @param speedKph   speed in km/h; useful for ETAs and for spotting a spoofed position
 * @param accuracyM  reported GPS accuracy in metres
 * @param at         when the reading was taken
 */
public record DriverPosition(double lat,
                            double lon,
                            double headingDeg,
                            double speedKph,
                            double accuracyM,
                            Instant at) {

    public static DriverPosition of(double lat, double lon, Double headingDeg, Double speedKph, Double accuracyM,
                                    Instant at) {
        return new DriverPosition(lat, lon, headingDeg == null ? 0d : headingDeg,
                speedKph == null ? 0d : speedKph, accuracyM == null ? 0d : accuracyM,
                at == null ? Instant.now() : at);
    }
}
