package kz.taxi.dispatch.domain;

import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/**
 * What counts as a usable position.
 *
 * <p>These rules exist because one bad coordinate corrupts the candidate search
 * for every rider nearby: a driver parked in the Gulf of Guinea is a car that can
 * never arrive.
 */
class GeoMathTest {

    private static final Duration TOLERANCE = Duration.ofSeconds(20);

    @Test
    @DisplayName("accepts an ordinary city position")
    void accepts_valid() {
        GeoMath.requireValid(43.2389, 76.8897, 8d, 34d);
    }

    @Test
    @DisplayName("refuses coordinates outside the planet")
    void refuses_impossible_coordinates() {
        assertThatThrownBy(() -> GeoMath.requireValid(91d, 76.8897, 8d, 0d))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.INVALID_POSITION));
        assertThatThrownBy(() -> GeoMath.requireValid(43.2389, 181d, 8d, 0d))
                .isInstanceOf(DomainException.class);
        assertThatThrownBy(() -> GeoMath.requireValid(Double.NaN, 76.8897, 8d, 0d))
                .isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("refuses an accuracy too coarse to route a car by")
    void refuses_unusable_accuracy() {
        assertThatThrownBy(() -> GeoMath.requireValid(43.2389, 76.8897, 50_000d, 0d))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.INVALID_POSITION);
                    assertThat(ex.details()).containsKey("accuracyM");
                });
        assertThatThrownBy(() -> GeoMath.requireValid(43.2389, 76.8897, -1d, 0d))
                .isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("refuses a speed no car in a city can reach")
    void refuses_implausible_speed() {
        assertThatThrownBy(() -> GeoMath.requireValid(43.2389, 76.8897, 8d, 900d))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.INVALID_POSITION);
                    assertThat(ex.details()).containsKey("speedKph");
                });
        assertThatThrownBy(() -> GeoMath.requireValid(43.2389, 76.8897, 8d, -5d))
                .isInstanceOf(DomainException.class);
    }

    @Test
    @DisplayName("measures a known Almaty distance the way PostGIS does")
    void measures_distance() {
        // Cross-checked against the stack itself: ST_Distance on the same two
        // points in taxi_dispatch returns 4060 m. Two independent implementations
        // agreeing is what makes either of them trustworthy.
        double meters = GeoMath.haversineMeters(43.25d, 76.90d, 43.25d, 76.95d);

        assertThat(meters).isCloseTo(4060d, within(60d));
    }

    @Test
    @DisplayName("a reading is stale once it is older than the tolerance")
    void decides_staleness() {
        Instant now = Instant.parse("2026-10-02T09:00:00Z");

        assertThat(GeoMath.isStale(now.minusSeconds(5), now, TOLERANCE)).isFalse();
        assertThat(GeoMath.isStale(now.minusSeconds(20), now, TOLERANCE)).isFalse();
        assertThat(GeoMath.isStale(now.minusSeconds(21), now, TOLERANCE)).isTrue();
        // A position without a timestamp cannot be trusted at all.
        assertThat(GeoMath.isStale(null, now, TOLERANCE)).isTrue();
    }
}
