package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;

/**
 * The service classes a rider can order.
 *
 * <p>Only the name lives here. What a class costs is configuration
 * ({@code taxi.trip.tariffs}) and deliberately not an enum constant: prices change
 * with the city, the season and the fuel price, and a release must not be needed to
 * change a number that a product manager owns.
 */
public enum Tariff {

    /** The everyday class: cheapest base fare, smallest car. */
    ECONOMY,

    /** Roomier cars and a higher per-kilometre rate. */
    COMFORT;

    /**
     * Parses the string form used by the API.
     *
     * <p>Case-insensitive because the value travels through JSON, a mobile form and a
     * support tool, and refusing {@code "economy"} would be a bug report about the
     * client, not about the tariff.
     */
    public static Tariff of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw DomainException.of(TripErrorCode.INVALID_TARIFF, "tariff is required");
        }
        try {
            return valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException unknown) {
            throw DomainException.of(TripErrorCode.INVALID_TARIFF,
                            "tariff '{}' is not one of {}", raw, java.util.Arrays.toString(values()))
                    .withDetail("tariff", raw);
        }
    }
}
