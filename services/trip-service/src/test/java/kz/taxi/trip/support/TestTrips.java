package kz.taxi.trip.support;

import kz.taxi.common.core.money.Currency;
import kz.taxi.trip.domain.FareCalculator;
import kz.taxi.trip.domain.FareQuote;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.RouteEstimate;
import kz.taxi.trip.domain.RouteEstimator;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.TariffRates;
import kz.taxi.trip.domain.Trip;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

/**
 * Trips, quotes and prices for tests, built with the same rules production uses.
 *
 * <p>Fixture objects are built through the real factories ({@code Quote.issue},
 * {@code Trip.request}) rather than through reflection or a test-only constructor: a test
 * that can assemble a state the service cannot produce proves nothing about the service.
 */
public final class TestTrips {

    /** Fixed clock instant: prices and TTLs in these tests never depend on the wall clock. */
    public static final Instant NOW = Instant.parse("2025-05-01T10:00:00Z");

    public static final String RIDER = "U-RIDER";
    public static final String OTHER_RIDER = "U-OTHER";
    public static final String RIDER_ACCOUNT = "A-RIDER";
    public static final String DRIVER = "D-DRIVER";

    /** The pilot city's price list, as the configuration file spells it out. */
    public static final TariffRates ECONOMY_RATES = new TariffRates(35_000L, 12_000L, 2_500L, 50_000L);
    public static final TariffRates COMFORT_RATES = new TariffRates(60_000L, 18_000L, 3_500L, 80_000L);

    public static final int COMMISSION_BP = 1_200;

    /** A ride of a bit over five kilometres: the ordinary case in these tests. */
    public static final RouteEstimate ROUTE = new RouteEstimate(5_000, 600);

    private TestTrips() {
    }

    public static FareCalculator calculator() {
        return calculator(COMMISSION_BP);
    }

    public static FareCalculator calculator(int commissionBp) {
        return new FareCalculator(Map.of(Tariff.ECONOMY, ECONOMY_RATES, Tariff.COMFORT, COMFORT_RATES),
                commissionBp);
    }

    public static RouteEstimator estimator() {
        return new RouteEstimator(1.35d, 28d, Duration.ofMinutes(3));
    }

    public static FareQuote fare(Tariff tariff, RouteEstimate route) {
        return calculator().quote(tariff, route);
    }

    public static Quote quote() {
        return quote(RIDER, Tariff.ECONOMY);
    }

    public static Quote quote(String riderUserId, Tariff tariff) {
        return quote(riderUserId, tariff, ROUTE, NOW, Duration.ofMinutes(5));
    }

    public static Quote quote(String riderUserId,
                              Tariff tariff,
                              RouteEstimate route,
                              Instant issuedAt,
                              Duration ttl) {
        return Quote.issue(riderUserId, RIDER_ACCOUNT, tariff,
                43.2389d, 76.8897d, "Абая 150",
                43.2500d, 76.9000d, "Достык 5",
                Currency.KZT, fare(tariff, route), issuedAt, ttl);
    }

    // ------------------------------------------------------------------ trips

    public static Trip searching() {
        return searching("idem-1");
    }

    public static Trip searching(String idempotencyKey) {
        return Trip.request(RIDER, quote(), idempotencyKey, "позвоните, когда будете у подъезда", NOW);
    }

    /** SEARCHING -> ASSIGNED, with the fare reserved under a hold. */
    public static Trip assigned() {
        Trip trip = searching();
        trip.attachHold("H-1");
        trip.markAssigned(DRIVER, "Айдар", null, NOW.plusSeconds(20));
        return trip;
    }

    public static Trip arrived() {
        Trip trip = assigned();
        trip.markArrived(NOW.plusSeconds(120));
        return trip;
    }

    public static Trip inProgress() {
        Trip trip = arrived();
        trip.markStarted(NOW.plusSeconds(150));
        return trip;
    }

    public static Trip completed() {
        Trip trip = inProgress();
        trip.markHoldCaptured("TX-1");
        trip.markCompleted("TX-1", NOW.plusSeconds(900));
        return trip;
    }

    public static Trip cancelledByRider() {
        Trip trip = assigned();
        trip.cancel(kz.taxi.trip.domain.TripStatus.CANCELLED_BY_RIDER, "передумал", NOW.plusSeconds(60));
        trip.markHoldReleased();
        return trip;
    }

    /**
     * A ride that is cancelled in the database while its fare is still reserved.
     *
     * <p>The window the healing closes: the cancellation committed, the release did not
     * happen. It is a real state — a crash between the two — and one this service has to be
     * able to repair rather than report.
     */
    public static Trip cancelledWithLiveHold() {
        Trip trip = assigned();
        trip.cancel(kz.taxi.trip.domain.TripStatus.CANCELLED_BY_RIDER, "передумал", NOW.plusSeconds(60));
        return trip;
    }

    public static Trip noDriversFound() {
        Trip trip = searching();
        trip.markNoDriversFound(NOW.plusSeconds(5));
        return trip;
    }
}
