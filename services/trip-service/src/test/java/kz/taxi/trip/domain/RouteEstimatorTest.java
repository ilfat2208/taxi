package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The route approximation, pinned down so that its deliberate simplifications are visible.
 *
 * <p>These tests are as much documentation as verification: they state what the estimate
 * is (a straight line, inflated and divided by an average speed) and what it therefore is
 * not (a real route). When OSRM replaces {@link RouteEstimator}, they are the tests that
 * have to change — which is exactly where the change should be noticed.
 */
class RouteEstimatorTest {

    /** The pilot city: a 1.35 detour factor, 28 km/h average, three minutes to reach the rider. */
    private final RouteEstimator estimator = new RouteEstimator(1.35d, 28d, Duration.ofMinutes(3));

    @Test
    @DisplayName("the distance is the straight line inflated by the road factor")
    void distance_is_the_straight_line_times_the_road_factor() {
        // 0.01 degrees of latitude is about 1 112 m on the great circle.
        RouteEstimate route = estimator.estimate(43.2389d, 76.8897d, 43.2489d, 76.8897d);

        double straightLine = GeoMath.haversineMeters(43.2389d, 76.8897d, 43.2489d, 76.8897d);
        assertThat((double) route.distanceM()).isCloseTo(straightLine * 1.35d, org.assertj.core.data.Offset.offset(2d));
        assertThat(route.distanceM()).isGreaterThan((int) straightLine);
    }

    @Test
    @DisplayName("the duration is the travel time plus the pickup allowance")
    void duration_includes_the_pickup_allowance() {
        RouteEstimate route = estimator.estimate(43.2389d, 76.8897d, 43.2489d, 76.8897d);

        double metresPerSecond = 28d * 1000d / 3600d;
        int expectedTravelS = (int) Math.ceil(route.distanceM() / metresPerSecond);
        assertThat(route.durationS()).isEqualTo(expectedTravelS + 180);
    }

    @Test
    @DisplayName("a point that cannot exist is refused before it is priced")
    void an_impossible_point_is_refused() {
        assertThatThrownBy(() -> estimator.estimate(91d, 76.8897d, 43.2489d, 76.8897d))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES);
                    assertThat(ex.details()).containsEntry("point", "pickup");
                });
        assertThatThrownBy(() -> estimator.estimate(43.2389d, 76.8897d, 43.2489d, 181d))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES);
                    assertThat(ex.details()).containsEntry("point", "dropoff");
                });
    }

    @Test
    @DisplayName("a detour factor below one, or a speed of zero, is a configuration error")
    void impossible_configuration_is_refused() {
        assertThatThrownBy(() -> new RouteEstimator(0.9d, 28d, Duration.ofMinutes(3)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RouteEstimator(1.35d, 0d, Duration.ofMinutes(3)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RouteEstimator(1.35d, 28d, Duration.ofMinutes(-1)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("a pickup and a dropoff at the same point still cost the pickup allowance")
    void a_zero_length_ride_still_takes_time_to_start() {
        RouteEstimate route = estimator.estimate(43.2389d, 76.8897d, 43.2389d, 76.8897d);

        assertThat(route.distanceM()).isZero();
        assertThat(route.durationS()).isEqualTo(180);
    }
}
