package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The geometry the quote depends on.
 *
 * <p>The formula is the same one dispatch-service uses to validate a driver's reading, and
 * it is checked here for the properties a quote relies on: a point is zero metres from
 * itself, the distance is symmetric (a route there is as long as the route back, before the
 * road factor says otherwise), and a coordinate that cannot exist is refused with a message
 * that names which end of the ride is wrong.
 */
class GeoMathTest {

    private static final double ALMATY_LAT = 43.2389d;
    private static final double ALMATY_LON = 76.8897d;

    @Test
    @DisplayName("a point is at zero distance from itself")
    void a_point_is_zero_from_itself() {
        assertThat(GeoMath.haversineMeters(ALMATY_LAT, ALMATY_LON, ALMATY_LAT, ALMATY_LON)).isZero();
    }

    @Test
    @DisplayName("0.01 degrees of latitude is about 1.1 km, and the distance is symmetric")
    void a_degree_of_latitude_is_about_a_hundred_and_eleven_kilometres() {
        double metres = GeoMath.haversineMeters(ALMATY_LAT, ALMATY_LON, ALMATY_LAT + 0.01d, ALMATY_LON);
        double back = GeoMath.haversineMeters(ALMATY_LAT + 0.01d, ALMATY_LON, ALMATY_LAT, ALMATY_LON);

        assertThat(metres).isCloseTo(1_112d, org.assertj.core.data.Offset.offset(5d));
        assertThat(back).isEqualTo(metres);
    }

    @Test
    @DisplayName("a coordinate outside the planet is refused, and the message names the end")
    void an_impossible_coordinate_is_refused() {
        assertThatThrownBy(() -> GeoMath.requireValidCoordinates(-91d, 76.8897d, "pickup"))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES);
                    assertThat(ex.details()).containsEntry("point", "pickup").containsEntry("lat", -91d);
                });
        assertThatThrownBy(() -> GeoMath.requireValidCoordinates(43.2389d, 200d, "dropoff"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES));
    }

    @Test
    @DisplayName("a coordinate that is not a number is refused too")
    void a_nan_coordinate_is_refused() {
        assertThatThrownBy(() -> GeoMath.requireValidCoordinates(Double.NaN, 76.8897d, "pickup"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES));
        assertThatThrownBy(() -> GeoMath.requireValidCoordinates(ALMATY_LAT, Double.NaN, "pickup"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES));
    }

    @Test
    @DisplayName("the extremes of the valid range are accepted")
    void the_valid_range_is_inclusive() {
        GeoMath.requireValidCoordinates(90d, 180d, "pickup");
        GeoMath.requireValidCoordinates(-90d, -180d, "dropoff");
    }
}
