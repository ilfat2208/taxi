package kz.taxi.catalog.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Catalog tuning knobs.
 *
 * @param reservationTtl how long a checkout may hold stock before the expiry job
 *                       takes it back; also the ceiling on how long an abandoned
 *                       cart can hide sellable inventory. A {@link Duration}
 *                       because it is a business deadline, bound from
 *                       {@code taxi.catalog.reservation-ttl} (default {@code 30m})
 *                       and read by {@code StockReservationService}.
 */
@ConfigurationProperties(prefix = "taxi.catalog")
public record CatalogProperties(Duration reservationTtl) {

    private static final Duration DEFAULT_RESERVATION_TTL = Duration.ofMinutes(30);

    public CatalogProperties {
        reservationTtl = positiveOrDefault(reservationTtl, DEFAULT_RESERVATION_TTL);
    }

    /** Fail safe towards the default: a zero or negative TTL would expire stock instantly. */
    private static Duration positiveOrDefault(Duration value, Duration fallback) {
        return value == null || value.isZero() || value.isNegative() ? fallback : value;
    }
}
