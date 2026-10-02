package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The price formula: base plus kilometres plus minutes, and the commission that comes out
 * of it.
 *
 * <p>The numbers are asserted exactly, not approximately. A fare is a promise about money,
 * and "about 120 000 tiyn" is not a promise — the whole point of integer arithmetic all the
 * way down is that the same ride always costs the same tenge.
 */
class FareCalculatorTest {

    private final FareCalculator calculator = TestTrips.calculator();

    @Test
    @DisplayName("economy on five kilometres and ten minutes: base + distance + time")
    void economy_price_is_the_sum_of_its_parts() {
        FareQuote fare = calculator.quote(Tariff.ECONOMY, new RouteEstimate(5_000, 600));

        // 12 000 tiyn/km x 5 km = 60 000; 2 500 tiyn/min x 10 min = 25 000; base 35 000.
        assertThat(fare.breakdown().baseMinor()).isEqualTo(35_000L);
        assertThat(fare.breakdown().distanceMinor()).isEqualTo(60_000L);
        assertThat(fare.breakdown().timeMinor()).isEqualTo(25_000L);
        assertThat(fare.priceMinor()).isEqualTo(120_000L);
        // 12% of 120 000 is 14 400, and the driver gets the rest by subtraction.
        assertThat(fare.commissionMinor()).isEqualTo(14_400L);
        assertThat(fare.driverNetMinor()).isEqualTo(105_600L);
        assertThat(fare.surgeBp()).isZero();
        assertThat(fare.driverNetMinor() + fare.commissionMinor()).isEqualTo(fare.priceMinor());
    }

    @Test
    @DisplayName("comfort costs more than economy on the same route")
    void comfort_is_dearer_than_economy() {
        RouteEstimate route = new RouteEstimate(7_000, 900);

        FareQuote economy = calculator.quote(Tariff.ECONOMY, route);
        FareQuote comfort = calculator.quote(Tariff.COMFORT, route);

        assertThat(comfort.priceMinor()).isGreaterThan(economy.priceMinor());
        assertThat(comfort.commissionMinor()).isGreaterThan(economy.commissionMinor());
    }

    @Test
    @DisplayName("a short ride is charged the minimum, and the breakdown still adds up")
    void the_minimum_fare_is_absorbed_by_the_base_component() {
        // 100 m and one minute: 1 200 + 2 500 = 3 700 tiyn of driving, against a 50 000 floor.
        FareQuote fare = calculator.quote(Tariff.ECONOMY, new RouteEstimate(100, 60));

        assertThat(fare.priceMinor()).isEqualTo(TestTrips.ECONOMY_RATES.minFareMinor());
        assertThat(fare.breakdown().baseMinor()).isEqualTo(46_300L);
        assertThat(fare.breakdown().distanceMinor()).isEqualTo(1_200L);
        assertThat(fare.breakdown().timeMinor()).isEqualTo(2_500L);
        // The reason the shortfall is folded into the base: the parts must still add up to
        // the price, because the database enforces exactly that.
        assertThat(fare.breakdown().totalMinor()).isEqualTo(fare.priceMinor());
    }

    @Test
    @DisplayName("a started minute is charged: a 61-second wait is two minutes")
    void a_started_minute_is_charged() {
        long oneMinute = calculator.quote(Tariff.ECONOMY, new RouteEstimate(1_000, 60)).breakdown().timeMinor();
        long justOverOneMinute = calculator.quote(Tariff.ECONOMY, new RouteEstimate(1_000, 61))
                .breakdown().timeMinor();

        assertThat(oneMinute).isEqualTo(2_500L);
        assertThat(justOverOneMinute).isEqualTo(5_000L);
    }

    @Test
    @DisplayName("commission rounds half up and the driver keeps the difference")
    void commission_rounds_half_up() {
        // A price of exactly 10 tiyn at 15%: the true commission is 1.5, which must round to
        // 2 — and the driver's 8 is what makes the sum exact rather than the second rounding.
        FareCalculator tiny = new FareCalculator(
                Map.of(Tariff.ECONOMY, new TariffRates(10L, 0L, 0L, 0L)), 1_500);

        FareQuote fare = tiny.quote(Tariff.ECONOMY, new RouteEstimate(0, 0));

        assertThat(fare.priceMinor()).isEqualTo(10L);
        assertThat(fare.commissionMinor()).isEqualTo(2L);
        assertThat(fare.driverNetMinor()).isEqualTo(8L);
        assertThat(fare.driverNetMinor() + fare.commissionMinor()).isEqualTo(fare.priceMinor());
    }

    @Test
    @DisplayName("a tariff that would price a ride at zero is refused, not given away")
    void a_free_ride_is_refused() {
        FareCalculator free = new FareCalculator(
                Map.of(Tariff.ECONOMY, new TariffRates(0L, 0L, 0L, 0L)), 1_200);

        assertThatThrownBy(() -> free.quote(Tariff.ECONOMY, new RouteEstimate(1_000, 300)))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_FARE));
    }

    @Test
    @DisplayName("a tariff without rates is refused with a code the client can act on")
    void an_unpriced_tariff_is_refused() {
        FareCalculator economyOnly = new FareCalculator(
                Map.of(Tariff.ECONOMY, TestTrips.ECONOMY_RATES), 1_200);

        assertThatThrownBy(() -> economyOnly.quote(Tariff.COMFORT, new RouteEstimate(1_000, 300)))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TARIFF));
    }

    @Test
    @DisplayName("a commission outside 0..9999 basis points is a configuration error")
    void a_nonsensical_commission_is_refused() {
        assertThatThrownBy(() -> new FareCalculator(Map.of(Tariff.ECONOMY, TestTrips.ECONOMY_RATES), 10_000))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FareCalculator(Map.of(Tariff.ECONOMY, TestTrips.ECONOMY_RATES), -1))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
