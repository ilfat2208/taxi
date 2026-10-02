package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The check: the document a rider reads after a ride and support reads during a dispute.
 *
 * <p>The two arithmetic invariants are asserted on real trips of every shape, and the
 * constructor is shown to refuse a receipt that does not add up — because a receipt with a
 * hole in it is worse than no receipt at all.
 */
class TripReceiptTest {

    @Test
    @DisplayName("the check of a performed ride carries the route, the price and the driver")
    void a_receipt_carries_the_ride() {
        Trip trip = TestTrips.completed();

        TripReceipt receipt = TripReceipt.of(trip);

        assertThat(receipt.tripId()).isEqualTo(trip.getId());
        assertThat(receipt.tripNumber()).isEqualTo(trip.getTripNumber());
        assertThat(receipt.status()).isEqualTo(TripStatus.COMPLETED);
        assertThat(receipt.completedAt()).isEqualTo(trip.getCompletedAt());
        assertThat(receipt.tariff()).isEqualTo(Tariff.ECONOMY);
        assertThat(receipt.pickupAddress()).isEqualTo("Абая 150");
        assertThat(receipt.dropoffAddress()).isEqualTo("Достык 5");
        assertThat(receipt.pickupLat()).isEqualTo(43.2389d);
        assertThat(receipt.distanceM()).isEqualTo(5_000);
        assertThat(receipt.durationS()).isEqualTo(600);
        assertThat(receipt.currency()).isEqualTo(Currency.KZT);
        assertThat(receipt.driverId()).isEqualTo(TestTrips.DRIVER);
        assertThat(receipt.driverDisplayName()).isEqualTo("Айдар");
        assertThat(receipt.holdId()).isEqualTo("H-1");
        assertThat(receipt.transactionId()).isEqualTo("TX-1");
        // No payment-service payment stands behind a wallet ride; the ledger transaction is
        // the money reference in Ф2, and the field is reserved for card payments later.
        assertThat(receipt.paymentId()).isNull();
    }

    @Test
    @DisplayName("the parts add up to the price and the split adds up to the price")
    void the_invariants_hold_for_every_tariff() {
        for (Tariff tariff : Tariff.values()) {
            Trip trip = Trip.request(TestTrips.RIDER,
                    TestTrips.quote(TestTrips.RIDER, tariff, TestTrips.ROUTE, TestTrips.NOW,
                            java.time.Duration.ofMinutes(5)),
                    "idem-" + tariff, null, TestTrips.NOW);
            trip.attachHold("H-1");
            trip.markAssigned(TestTrips.DRIVER, "Айдар", null, TestTrips.NOW.plusSeconds(10));
            trip.markArrived(TestTrips.NOW.plusSeconds(60));
            trip.markStarted(TestTrips.NOW.plusSeconds(90));
            trip.markHoldCaptured("TX-1");
            trip.markCompleted("TX-1", TestTrips.NOW.plusSeconds(600));

            TripReceipt receipt = TripReceipt.of(trip);

            assertThat(receipt.breakdown().baseMinor() + receipt.breakdown().distanceMinor()
                    + receipt.breakdown().timeMinor())
                    .as("%s components", tariff)
                    .isEqualTo(receipt.priceMinor());
            assertThat(receipt.driverNetMinor() + receipt.commissionMinor())
                    .as("%s split", tariff)
                    .isEqualTo(receipt.priceMinor());
            assertThat(receipt.commissionBp()).isEqualTo(TestTrips.COMMISSION_BP);
        }
    }

    @Test
    @DisplayName("a receipt exists only for a ride that happened")
    void a_receipt_of_a_live_ride_is_refused() {
        List<Trip> live = List.of(TestTrips.searching(), TestTrips.assigned(), TestTrips.arrived(),
                TestTrips.inProgress(), TestTrips.cancelledByRider(), TestTrips.noDriversFound());

        for (Trip trip : live) {
            assertThatThrownBy(() -> TripReceipt.of(trip))
                    .as("receipt of a %s ride", trip.getStatus())
                    .isInstanceOfSatisfying(DomainException.class, ex ->
                            assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_COMPLETED));
        }
    }

    @Test
    @DisplayName("a receipt whose numbers do not add up is not constructed at all")
    void a_receipt_that_does_not_add_up_is_refused() {
        Trip trip = TestTrips.completed();

        assertThatThrownBy(() -> new TripReceipt(trip.getId(), trip.getTripNumber(), TripStatus.COMPLETED,
                trip.getCompletedAt(), Tariff.ECONOMY, 43.2d, 76.8d, null, 43.3d, 76.9d, null,
                5_000, 600, new FareBreakdown(35_000L, 60_000L, 25_000L), 0,
                // A price that the components below do not produce.
                130_000L, 1_200, 14_400L, 105_600L, Currency.KZT, TestTrips.DRIVER, "Айдар", "H-1", null, "TX-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("do not add up");

        assertThatThrownBy(() -> new TripReceipt(trip.getId(), trip.getTripNumber(), TripStatus.COMPLETED,
                trip.getCompletedAt(), Tariff.ECONOMY, 43.2d, 76.8d, null, 43.3d, 76.9d, null,
                5_000, 600, new FareBreakdown(35_000L, 60_000L, 25_000L), 0,
                120_000L, 1_200, 14_400L, 106_000L, Currency.KZT, TestTrips.DRIVER, "Айдар", "H-1", null, "TX-1"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("does not equal price");
    }
}
