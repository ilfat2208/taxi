package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The ride's state machine and its money invariants.
 *
 * <p>The rules checked here are the ones a service above this class must not be able to
 * bypass: forward-only transitions, no cancellation once the rider is in the car, a rating
 * only for a ride that happened, and a commission that always adds up to the price.
 */
class TripTest {

    // ------------------------------------------------------------------ creation

    @Test
    @DisplayName("a new trip is SEARCHING and carries the price the rider agreed to")
    void a_new_trip_is_searching_and_priced_from_the_quote() {
        Trip trip = TestTrips.searching();

        assertThat(trip.getStatus()).isEqualTo(TripStatus.SEARCHING);
        assertThat(trip.getPriceMinor()).isEqualTo(120_000L);
        assertThat(trip.getCommissionMinor()).isEqualTo(14_400L);
        assertThat(trip.getDriverNetMinor()).isEqualTo(105_600L);
        assertThat(trip.getCommissionBp()).isEqualTo(TestTrips.COMMISSION_BP);
        assertThat(trip.getRiderAccountId()).isEqualTo(TestTrips.RIDER_ACCOUNT);
        assertThat(trip.getHoldStatus()).isEqualTo(TripHoldStatus.NONE);
        assertThat(trip.getHoldId()).isNull();
        assertThat(trip.getRequestedAt()).isEqualTo(TestTrips.NOW);
        assertThat(trip.getTripNumber()).startsWith("T").hasSize(27);
    }

    @Test
    @DisplayName("the price is copied, not referenced: the parts and the split always add up")
    void price_and_split_always_add_up() {
        for (RouteEstimate route : java.util.List.of(
                new RouteEstimate(0, 0), new RouteEstimate(120, 60), new RouteEstimate(5_000, 600),
                new RouteEstimate(48_000, 3_600))) {
            for (Tariff tariff : Tariff.values()) {
                FareQuote fare = TestTrips.fare(tariff, route);
                assertThat(fare.breakdown().totalMinor())
                        .as("%s on %s m", tariff, route.distanceM())
                        .isEqualTo(fare.priceMinor());
                assertThat(fare.driverNetMinor() + fare.commissionMinor())
                        .as("%s driver share", tariff)
                        .isEqualTo(fare.priceMinor());
            }
        }
    }

    @Test
    @DisplayName("an order without an idempotency key cannot be recorded")
    void an_order_without_a_key_is_refused() {
        assertThatThrownBy(() -> Trip.request(TestTrips.RIDER, TestTrips.quote(), "  ", null, TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_REQUEST));
    }

    // ------------------------------------------------------------------ assignment

    @Test
    @DisplayName("assignment claims the driver, records the hold and stamps the moment")
    void assignment_moves_the_ride_forward() {
        Trip trip = TestTrips.assigned();

        assertThat(trip.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        assertThat(trip.getDriverId()).isEqualTo(TestTrips.DRIVER);
        assertThat(trip.getDriverName()).isEqualTo("Айдар");
        assertThat(trip.getHoldId()).isEqualTo("H-1");
        assertThat(trip.getHoldStatus()).isEqualTo(TripHoldStatus.ACTIVE);
        assertThat(trip.hasActiveHold()).isTrue();
        assertThat(trip.getAssignedAt()).isEqualTo(TestTrips.NOW.plusSeconds(20));
    }

    @Test
    @DisplayName("a second driver is refused: two cars at one door is worse than an error")
    void a_second_driver_is_refused() {
        Trip trip = TestTrips.assigned();

        assertThatThrownBy(() -> trip.markAssigned("D-OTHER", "Ерлан", null, TestTrips.NOW.plusSeconds(30)))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_ASSIGNABLE));
    }

    @Test
    @DisplayName("re-assigning the same driver is a no-op, not a second transition")
    void the_same_driver_may_be_assigned_again() {
        Trip trip = TestTrips.assigned();
        java.time.Instant assignedAt = trip.getAssignedAt();

        trip.markAssigned(TestTrips.DRIVER, "Айдар", null, TestTrips.NOW.plusSeconds(45));

        assertThat(trip.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        assertThat(trip.getAssignedAt()).isEqualTo(assignedAt);
    }

    @Test
    @DisplayName("a hold cannot be replaced by a different one")
    void a_hold_cannot_be_replaced() {
        Trip trip = TestTrips.searching();
        trip.attachHold("H-1");

        assertThatThrownBy(() -> trip.attachHold("H-2"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.HOLD_FAILED));
    }

    // ------------------------------------------------------------------ forward only

    @Test
    @DisplayName("a searching ride cannot skip the driver and arrive")
    void transitions_are_forward_only() {
        Trip trip = TestTrips.searching();

        assertThatThrownBy(() -> trip.markArrived(TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_TRANSITION));
        assertThatThrownBy(() -> trip.markCompleted("TX", TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_TRANSITION));
    }

    @Test
    @DisplayName("no drivers found is not reachable once a car is on the way")
    void no_drivers_found_is_only_reachable_from_searching() {
        Trip trip = TestTrips.assigned();

        assertThatThrownBy(() -> trip.markNoDriversFound(TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_TRANSITION));
    }

    @Test
    @DisplayName("NO_DRIVERS_FOUND closes the request and stamps when it ended")
    void no_drivers_found_closes_the_request() {
        Trip trip = TestTrips.searching();
        trip.markNoDriversFound(TestTrips.NOW.plusSeconds(4));

        assertThat(trip.getStatus()).isEqualTo(TripStatus.NO_DRIVERS_FOUND);
        assertThat(trip.getStatus().isTerminal()).isTrue();
        assertThat(trip.getCancelledAt()).isEqualTo(TestTrips.NOW.plusSeconds(4));
        assertThat(trip.getDriverId()).isNull();
    }

    // ------------------------------------------------------------------ cancellation

    @Test
    @DisplayName("the rider can call off a ride that has not started")
    void a_rider_may_cancel_before_the_ride_starts() {
        Trip trip = TestTrips.assigned();
        trip.cancel(TripStatus.CANCELLED_BY_RIDER, "передумал", TestTrips.NOW.plusSeconds(60));

        assertThat(trip.getStatus()).isEqualTo(TripStatus.CANCELLED_BY_RIDER);
        assertThat(trip.getCancelReason()).isEqualTo("передумал");
        assertThat(trip.getCancelledAt()).isEqualTo(TestTrips.NOW.plusSeconds(60));
        assertThat(trip.getStatus().isCancellable()).isFalse();
    }

    @Test
    @DisplayName("a ride whose driver could not perform is cancelled by the driver side")
    void the_driver_side_may_cancel_before_the_ride_starts() {
        Trip trip = TestTrips.arrived();
        trip.cancel(TripStatus.CANCELLED_BY_DRIVER, "сломался", TestTrips.NOW.plusSeconds(200));

        assertThat(trip.getStatus()).isEqualTo(TripStatus.CANCELLED_BY_DRIVER);
    }

    @Test
    @DisplayName("once the rider is in the car the fare is owed: cancellation is refused")
    void a_ride_in_progress_cannot_be_cancelled() {
        Trip trip = TestTrips.inProgress();

        assertThatThrownBy(() -> trip.cancel(TripStatus.CANCELLED_BY_RIDER, "передумал", TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_CANCELLABLE));
        assertThatThrownBy(() -> trip.cancel(TripStatus.CANCELLED_BY_DRIVER, "не хочу", TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_CANCELLABLE));
    }

    @Test
    @DisplayName("a completed ride cannot be cancelled either")
    void a_completed_ride_cannot_be_cancelled() {
        Trip trip = TestTrips.completed();

        assertThatThrownBy(() -> trip.cancel(TripStatus.CANCELLED_BY_RIDER, "уже поздно", TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_CANCELLABLE));
    }

    @Test
    @DisplayName("a cancellation status is the only status cancel() accepts")
    void cancel_refuses_a_non_cancellation_target() {
        Trip trip = TestTrips.assigned();

        assertThatThrownBy(() -> trip.cancel(TripStatus.COMPLETED, "не то", TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_TRANSITION));
    }

    // ------------------------------------------------------------------ money moves once

    @Test
    @DisplayName("the hold becomes a charge exactly once")
    void money_cannot_be_captured_twice() {
        Trip trip = TestTrips.inProgress();
        trip.markHoldCaptured("TX-1");

        assertThat(trip.getHoldStatus()).isEqualTo(TripHoldStatus.CAPTURED);
        assertThat(trip.hasActiveHold()).isFalse();
        assertThatThrownBy(() -> trip.markHoldCaptured("TX-2"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.CAPTURE_FAILED));
    }

    @Test
    @DisplayName("a ride with nothing reserved cannot be captured")
    void capturing_without_a_reservation_is_refused() {
        Trip trip = TestTrips.searching();

        assertThatThrownBy(() -> trip.markHoldCaptured("TX-1"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.CAPTURE_FAILED));
    }

    @Test
    @DisplayName("releasing a hold twice is a no-op, so a repeated cancellation is safe")
    void a_hold_is_released_once() {
        Trip trip = TestTrips.assigned();
        trip.markHoldReleased();
        trip.markHoldReleased();

        assertThat(trip.getHoldStatus()).isEqualTo(TripHoldStatus.RELEASED);
        assertThat(trip.hasActiveHold()).isFalse();
    }

    @Test
    @DisplayName("completion stamps the moment and carries the ledger transaction")
    void completion_records_the_capture() {
        Trip trip = TestTrips.completed();

        assertThat(trip.getStatus()).isEqualTo(TripStatus.COMPLETED);
        assertThat(trip.getCompletedAt()).isEqualTo(TestTrips.NOW.plusSeconds(900));
        assertThat(trip.getCaptureTransactionId()).isEqualTo("TX-1");
        assertThat(trip.getHoldStatus()).isEqualTo(TripHoldStatus.CAPTURED);
        assertThat(trip.getStartedAt()).isEqualTo(TestTrips.NOW.plusSeconds(150));
    }

    // ------------------------------------------------------------------ rating

    @Test
    @DisplayName("a completed ride can be rated once")
    void a_completed_ride_is_rated_once() {
        Trip trip = TestTrips.completed();
        trip.rate(5, "отличный водитель", TestTrips.NOW.plusSeconds(1_000));

        assertThat(trip.getRatingStars()).isEqualTo(5);
        assertThat(trip.getRatingComment()).isEqualTo("отличный водитель");
        assertThat(trip.getRatedAt()).isNotNull();

        assertThatThrownBy(() -> trip.rate(1, "передумал", TestTrips.NOW.plusSeconds(2_000)))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_ALREADY_RATED));
        // The first answer stands: a rating is an opinion about one ride, not a field.
        assertThat(trip.getRatingStars()).isEqualTo(5);
    }

    @Test
    @DisplayName("a ride that did not happen cannot be rated")
    void a_ride_that_did_not_happen_cannot_be_rated() {
        Trip inProgress = TestTrips.inProgress();
        assertThatThrownBy(() -> inProgress.rate(5, null, TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_COMPLETED));

        Trip cancelled = TestTrips.cancelledByRider();
        assertThatThrownBy(() -> cancelled.rate(5, null, TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_COMPLETED));
    }

    @Test
    @DisplayName("the rating scale is enforced by the aggregate, not by the client")
    void a_rating_outside_the_scale_is_refused() {
        Trip trip = TestTrips.completed();

        for (int stars : new int[]{0, 6, -1}) {
            assertThatThrownBy(() -> trip.rate(stars, null, TestTrips.NOW))
                    .isInstanceOfSatisfying(DomainException.class, ex ->
                            assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_RATING));
        }
        assertThat(trip.getRatingStars()).isNull();
    }

    // ------------------------------------------------------------------ terminal

    @Test
    @DisplayName("terminal statuses are terminal: nothing moves after them")
    void terminal_statuses_do_not_move() {
        for (TripStatus status : TripStatus.values()) {
            for (TripStatus target : TripStatus.values()) {
                if (status.isTerminal()) {
                    assertThat(status.canMoveTo(target))
                            .as("%s -> %s", status, target)
                            .isFalse();
                }
            }
        }
        assertThat(TripStatus.COMPLETED.isCancellable()).isFalse();
        assertThat(TripStatus.COMPLETED.isRateable()).isTrue();
        assertThat(TripStatus.IN_PROGRESS.isCancellable()).isFalse();
        assertThat(TripStatus.live()).containsExactlyInAnyOrder(TripStatus.SEARCHING, TripStatus.ASSIGNED,
                TripStatus.ARRIVED, TripStatus.IN_PROGRESS);
    }
}
