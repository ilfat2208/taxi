package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripHoldStatus;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.infrastructure.TripProperties;
import kz.taxi.trip.infrastructure.TripRepository;
import kz.taxi.trip.infrastructure.client.DriverFinder;
import kz.taxi.trip.infrastructure.client.DriverRoster;
import kz.taxi.trip.infrastructure.client.RideAccountClient;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The saga: who gets found, whose money is reserved, and in what order.
 *
 * <p>The clients are mocked and the state service is mocked too, on purpose: what this
 * class has to get right is the <em>sequence</em> of remote effects — money before a car,
 * status before money, healing instead of a second charge — and that sequence is invisible
 * in a test that runs the whole thing against a real database. The database side is
 * covered by {@link TripStateServiceTest} and the domain rules by the domain tests.
 */
@ExtendWith(MockitoExtension.class)
class TripSagaServiceTest {

    private static final String KEY = "idem-1";
    private static final String TRIP_ID = "01HTRIP000000000000000001";
    private static final String QUOTE_ID = "Q-1";

    @Mock
    private TripStateService state;
    @Mock
    private TripRepository trips;
    @Mock
    private DriverFinder finder;
    @Mock
    private DriverRoster roster;
    @Mock
    private RideAccountClient accounts;

    private TripSagaService saga;

    @BeforeEach
    void setUp() {
        saga = new TripSagaService(state, trips, finder, roster, accounts, new TripProperties());
    }

    // ------------------------------------------------------------------ fixtures

    private static AuthenticatedUser rider() {
        return new AuthenticatedUser(TestTrips.RIDER, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    }

    private static AuthenticatedUser dispatcher() {
        return new AuthenticatedUser("U-DISP", "+77009999999", "Диспетчер", Set.of(Roles.DISPATCHER));
    }

    private static AuthenticatedUser merchant() {
        return new AuthenticatedUser("U-MERCHANT", "+77008888888", "Магазин", Set.of(Roles.MERCHANT));
    }

    private static DriverFinder.Candidate candidate(String driverId, String name) {
        return new DriverFinder.Candidate(driverId, name, 250d, 43.24d, 76.89d, 3L);
    }

    private static RideAccountClient.HoldView hold(String holdId) {
        return new RideAccountClient.HoldView(holdId, TestTrips.RIDER_ACCOUNT, 120_000L, "KZT", "ACTIVE",
                500_000L, TestTrips.NOW.plusSeconds(900), false);
    }

    private static DriverRoster.DriverView driverView(String driverId, String tripId) {
        return new DriverRoster.DriverView(driverId, "Айдар", "BUSY", tripId, false);
    }

    /** A trip the mock state service hands out: the fixture id is what production would use. */
    private static Trip searchingTrip() {
        return TestTrips.searching(KEY);
    }

    /** The stubs every ordering call starts with: no earlier key, a fresh ride created. */
    private void startOfSearch(Trip trip) {
        when(trips.findByIdempotencyKey(KEY)).thenReturn(Optional.empty());
        when(state.create(eq(TestTrips.RIDER), eq(QUOTE_ID), eq(KEY), any())).thenReturn(trip);
    }

    private TripDtos.CreateTripRequest order() {
        return new TripDtos.CreateTripRequest(QUOTE_ID, null);
    }

    // ------------------------------------------------------------------ the search

    @Test
    @DisplayName("no car in the city: the ride is closed as NO_DRIVERS_FOUND and no money is touched")
    void no_candidate_means_no_drivers_found() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt())).thenReturn(List.of());
        Trip closed = TestTrips.noDriversFound();
        when(state.markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM)).thenReturn(closed);

        Trip result = saga.request(rider(), order(), KEY);

        assertThat(result.getStatus()).isEqualTo(TripStatus.NO_DRIVERS_FOUND);
        verifyNoInteractions(accounts);
        verify(roster, never()).assignTrip(anyString(), anyString());
    }

    @Test
    @DisplayName("a car is reserved before it is claimed, and the ride becomes ASSIGNED")
    void a_candidate_is_claimed_and_the_fare_reserved_first() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(RideAccountClient.REFERENCE_TYPE_TRIP, trip.getId(),
                TestTrips.RIDER_ACCOUNT)).thenReturn(Optional.empty());
        when(accounts.placeHold(any())).thenReturn(hold("H-1"));
        when(roster.assignTrip("D-1", trip.getId())).thenReturn(driverView("D-1", trip.getId()));
        when(state.markAssigned(trip.getId(), "D-1", "Айдар", null, TripTransition.ACTOR_SYSTEM))
                .thenReturn(TestTrips.assigned());

        Trip result = saga.request(rider(), order(), KEY);

        assertThat(result.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        InOrder order = inOrder(accounts, state, roster);
        order.verify(accounts).placeHold(any());
        order.verify(state).attachHold(trip.getId(), "H-1");
        order.verify(roster).assignTrip("D-1", trip.getId());
        order.verify(state).markAssigned(trip.getId(), "D-1", "Айдар", null, TripTransition.ACTOR_SYSTEM);
    }

    @Test
    @DisplayName("the hold is keyed by the trip, so a retry cannot reserve a second fare")
    void the_hold_request_is_keyed_by_the_trip() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(accounts.placeHold(any())).thenReturn(hold("H-1"));
        when(roster.assignTrip(anyString(), anyString())).thenReturn(driverView("D-1", trip.getId()));
        when(state.markAssigned(anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(TestTrips.assigned());

        saga.request(rider(), order(), KEY);

        ArgumentCaptor<RideAccountClient.HoldRequest> captor =
                ArgumentCaptor.forClass(RideAccountClient.HoldRequest.class);
        verify(accounts).placeHold(captor.capture());
        RideAccountClient.HoldRequest request = captor.getValue();
        assertThat(request.referenceType()).isEqualTo(RideAccountClient.REFERENCE_TYPE_TRIP);
        assertThat(request.referenceId()).isEqualTo(trip.getId());
        assertThat(request.idempotencyKey()).isEqualTo("TRIP-HOLD-" + trip.getId());
        assertThat(request.amountMinor()).isEqualTo(trip.getPriceMinor());
        assertThat(request.accountId()).isEqualTo(TestTrips.RIDER_ACCOUNT);
    }

    @Test
    @DisplayName("the search uses the configured radius and limit")
    void the_search_uses_the_configured_radius() {
        TripProperties properties = new TripProperties();
        TripSagaService configured = new TripSagaService(state, trips, finder, roster, accounts, properties);
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt())).thenReturn(List.of());
        when(state.markNoDriversFound(anyString(), anyString())).thenReturn(TestTrips.noDriversFound());

        configured.request(rider(), order(), KEY);

        verify(finder).nearest(trip.getPickupLat(), trip.getPickupLon(),
                properties.getSearchRadiusM(), properties.getSearchLimit());
    }

    @Test
    @DisplayName("a busy candidate is skipped and the next one is claimed")
    void a_taken_candidate_does_not_end_the_search() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар"), candidate("D-2", "Ерлан")));
        when(accounts.findActiveHold(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(accounts.placeHold(any())).thenReturn(hold("H-1"));
        when(roster.assignTrip("D-1", trip.getId()))
                .thenThrow(DomainException.of(TripErrorCode.DRIVER_NOT_AVAILABLE, "busy"));
        when(roster.assignTrip("D-2", trip.getId())).thenReturn(driverView("D-2", trip.getId()));
        when(state.markAssigned(trip.getId(), "D-2", "Ерлан", null, TripTransition.ACTOR_SYSTEM))
                .thenReturn(TestTrips.assigned());

        Trip result = saga.request(rider(), order(), KEY);

        assertThat(result.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        // The reservation made for the first candidate is the one the second candidate
        // rides on: money is reserved once per trip, not once per attempt.
        verify(accounts).placeHold(any());
        verify(accounts, never()).release(anyString(), anyString());
        verify(state).markAssigned(trip.getId(), "D-2", "Ерлан", null, TripTransition.ACTOR_SYSTEM);
    }

    @Test
    @DisplayName("when every candidate is taken, the ride is closed and the fare given back")
    void every_candidate_taken_releases_the_fare() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(accounts.placeHold(any())).thenReturn(hold("H-1"));
        when(roster.assignTrip("D-1", trip.getId()))
                .thenThrow(DomainException.of(TripErrorCode.DRIVER_NOT_AVAILABLE, "busy"));
        Trip closed = TestTrips.searching(KEY);
        closed.attachHold("H-1");
        closed.markNoDriversFound(TestTrips.NOW.plusSeconds(5));
        when(state.markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM)).thenReturn(closed);
        Trip released = TestTrips.noDriversFound();
        when(state.markHoldReleased(closed.getId(), "no driver could be claimed")).thenReturn(released);

        Trip result = saga.request(rider(), order(), KEY);

        assertThat(result.getStatus()).isEqualTo(TripStatus.NO_DRIVERS_FOUND);
        // The status moves first: closing is the step that can be refused (a dispatcher may
        // have put a car on this very trip), and a refusal must not find the money gone.
        InOrder order = inOrder(state, accounts);
        order.verify(state).markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM);
        order.verify(accounts).release("H-1", "no driver could be claimed");
        order.verify(state).markHoldReleased(closed.getId(), "no driver could be claimed");
    }

    @Test
    @DisplayName("a ride decided by somebody else while the search ran is not fought over")
    void a_ride_closed_by_somebody_else_is_left_alone() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(accounts.placeHold(any())).thenReturn(hold("H-1"));
        when(roster.assignTrip("D-1", trip.getId()))
                .thenThrow(DomainException.of(TripErrorCode.DRIVER_NOT_AVAILABLE, "busy"));
        when(state.markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM))
                .thenThrow(DomainException.of(TripErrorCode.INVALID_TRIP_TRANSITION, "already assigned"));
        Trip assignedByDispatcher = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(assignedByDispatcher);

        Trip result = saga.request(rider(), order(), KEY);

        // The dispatcher's car wins: the ride is alive, its reservation belongs to it, and
        // the search does not release money behind its back.
        assertThat(result).isSameAs(assignedByDispatcher);
        verify(accounts, never()).release(anyString(), anyString());
    }

    @Test
    @DisplayName("a ride taken by another driver while our car is claimed is reported, not thrown")
    void a_ride_taken_during_the_claim_is_reported_as_it_is() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(accounts.placeHold(any())).thenReturn(hold("H-1"));
        when(roster.assignTrip("D-1", trip.getId())).thenReturn(driverView("D-1", trip.getId()));
        when(state.markAssigned(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_ASSIGNABLE, "another driver won"));
        Trip takenByDispatcher = TestTrips.assigned();
        // First read: the healer, which finds a live ride and therefore gives back only the car.
        // Second read: what the rider is told — the ride that actually exists.
        when(state.require(trip.getId())).thenReturn(takenByDispatcher, takenByDispatcher);

        Trip result = saga.request(rider(), order(), KEY);

        // An error about a race the rider cannot see or act on helps nobody: he gets the ride.
        assertThat(result).isSameAs(takenByDispatcher);
        assertThat(result.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        verify(accounts, never()).release(anyString(), anyString());
        verify(roster).finishTrip("D-1");
    }

    @Test
    @DisplayName("a refused wallet closes the ride on the rider's side and returns 422")
    void insufficient_funds_closes_the_ride() {
        Trip trip = searchingTrip();
        startOfSearch(trip);
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(anyString(), anyString(), anyString())).thenReturn(Optional.empty());
        when(accounts.placeHold(any()))
                .thenThrow(DomainException.of(TripErrorCode.INSUFFICIENT_FUNDS, "not enough"));

        assertThatThrownBy(() -> saga.request(rider(), order(), KEY))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INSUFFICIENT_FUNDS));

        verify(state).cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, "INSUFFICIENT_FUNDS",
                TripTransition.ACTOR_RIDER);
        // No car was disturbed for a rider who cannot pay.
        verify(roster, never()).assignTrip(anyString(), anyString());
        verify(accounts, never()).release(anyString(), anyString());
    }

    // ------------------------------------------------------------------ retries

    @Test
    @DisplayName("the same key returns the same ride and touches nothing")
    void a_retry_returns_the_same_ride() {
        Trip existing = TestTrips.assigned();
        when(trips.findByIdempotencyKey(KEY)).thenReturn(Optional.of(existing));

        Trip result = saga.request(rider(), order(), KEY);

        assertThat(result).isSameAs(existing);
        verifyNoInteractions(accounts, roster, finder);
        verify(state, never()).create(anyString(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("a resumed search adopts the hold that already exists instead of reserving again")
    void a_resumed_search_adopts_an_existing_hold() {
        Trip trip = searchingTrip();
        when(trips.findByIdempotencyKey(KEY)).thenReturn(Optional.of(trip));
        when(finder.nearest(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(List.of(candidate("D-1", "Айдар")));
        when(accounts.findActiveHold(RideAccountClient.REFERENCE_TYPE_TRIP, trip.getId(),
                TestTrips.RIDER_ACCOUNT)).thenReturn(Optional.of(hold("H-9")));
        when(roster.assignTrip("D-1", trip.getId())).thenReturn(driverView("D-1", trip.getId()));
        when(state.markAssigned(anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(TestTrips.assigned());

        saga.request(rider(), order(), KEY);

        verify(state).attachHold(trip.getId(), "H-9");
        verify(accounts, never()).placeHold(any());
    }

    @Test
    @DisplayName("a ride that already holds its fare does not ask the account service again")
    void a_ride_that_already_holds_does_not_reserve_again() {
        Trip trip = searchingTrip();
        trip.attachHold("H-1");
        when(state.require(trip.getId())).thenReturn(trip);
        when(roster.assignTrip("D-2", trip.getId())).thenReturn(driverView("D-2", trip.getId()));
        when(state.markAssigned(trip.getId(), "D-2", "Айдар", null, TripTransition.ACTOR_DISPATCHER))
                .thenReturn(TestTrips.assigned());

        saga.assign(trip.getId(), "D-2", null, null, TripTransition.ACTOR_DISPATCHER);

        verify(accounts, never()).findActiveHold(anyString(), anyString(), anyString());
        verify(accounts, never()).placeHold(any());
    }

    // ------------------------------------------------------------------ assign

    @Test
    @DisplayName("assigning the same driver again is a no-op, not a second reservation")
    void assign_is_idempotent_for_the_same_driver() {
        Trip assigned = TestTrips.assigned();
        when(state.require(assigned.getId())).thenReturn(assigned);

        Trip result = saga.assign(assigned.getId(), TestTrips.DRIVER, "Айдар", null,
                TripTransition.ACTOR_DISPATCHER);

        assertThat(result).isSameAs(assigned);
        verifyNoInteractions(accounts, roster);
        verify(state, never()).markAssigned(anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    @DisplayName("a second driver is refused and nothing is reserved for him")
    void assign_refuses_a_second_driver() {
        Trip assigned = TestTrips.assigned();
        when(state.require(assigned.getId())).thenReturn(assigned);

        assertThatThrownBy(() -> saga.assign(assigned.getId(), "D-2", "Ерлан", null,
                TripTransition.ACTOR_DISPATCHER))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_ASSIGNABLE));

        verifyNoInteractions(accounts, roster);
    }

    @Test
    @DisplayName("a closed ride cannot be assigned, and no money is touched")
    void assign_refuses_a_closed_ride() {
        Trip closed = TestTrips.noDriversFound();
        when(state.require(closed.getId())).thenReturn(closed);

        assertThatThrownBy(() -> saga.assign(closed.getId(), "D-2", "Ерлан", null,
                TripTransition.ACTOR_DISPATCHER))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_ASSIGNABLE));

        verifyNoInteractions(accounts, roster);
    }

    @Test
    @DisplayName("a driver who turns out to be busy costs the ride its reservation, not its money")
    void assign_releases_the_fare_when_the_driver_is_not_free() {
        Trip trip = searchingTrip();
        trip.attachHold("H-1");
        when(state.require(trip.getId())).thenReturn(trip);
        when(roster.assignTrip("D-9", trip.getId()))
                .thenThrow(DomainException.of(TripErrorCode.DRIVER_NOT_AVAILABLE, "busy"));
        when(state.markHoldReleased(trip.getId(), "driver D-9 could not be claimed")).thenReturn(trip);

        assertThatThrownBy(() -> saga.assign(trip.getId(), "D-9", null, null, TripTransition.ACTOR_DISPATCHER))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.DRIVER_NOT_AVAILABLE));

        verify(accounts).release("H-1", "driver D-9 could not be claimed");
    }

    @Test
    @DisplayName("an unknown claim outcome keeps the reservation: releasing would give the ride away")
    void assign_keeps_the_reservation_when_the_outcome_is_unknown() {
        Trip trip = searchingTrip();
        trip.attachHold("H-1");
        when(state.require(trip.getId())).thenReturn(trip);
        when(roster.assignTrip("D-9", trip.getId()))
                .thenThrow(DomainException.of(TripErrorCode.DOWNSTREAM_UNAVAILABLE, "driver-service did not answer"));

        assertThatThrownBy(() -> saga.assign(trip.getId(), "D-9", null, null, TripTransition.ACTOR_DISPATCHER))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.DOWNSTREAM_UNAVAILABLE));

        verify(accounts, never()).release(anyString(), anyString());
    }

    @Test
    @DisplayName("a car claimed for a ride that was closed in the meantime is given back")
    void a_car_claimed_for_a_closed_ride_is_released() {
        Trip trip = searchingTrip();
        trip.attachHold("H-1");
        when(roster.assignTrip("D-9", trip.getId())).thenReturn(driverView("D-9", trip.getId()));
        when(state.markAssigned(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.INVALID_TRIP_TRANSITION, "already cancelled"));
        // First read: the guard, which sees a live ride. Second read: the ride as it is now —
        // closed by the rider while the car was being claimed.
        Trip closedWithHold = TestTrips.searching(KEY);
        closedWithHold.attachHold("H-1");
        closedWithHold.markNoDriversFound(TestTrips.NOW);
        when(state.require(trip.getId())).thenReturn(trip, closedWithHold);
        when(state.markHoldReleased(closedWithHold.getId(),
                "ride was closed while a driver was being claimed")).thenReturn(closedWithHold);

        assertThatThrownBy(() -> saga.assign(trip.getId(), "D-9", null, null, TripTransition.ACTOR_DISPATCHER))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_TRANSITION));

        verify(accounts).release("H-1", "ride was closed while a driver was being claimed");
        verify(roster).finishTrip("D-9");
    }

    // ------------------------------------------------------------------ complete

    @Test
    @DisplayName("completion captures the fare, records the transaction and frees the driver")
    void complete_captures_and_releases_the_driver() {
        Trip trip = TestTrips.inProgress();
        when(state.require(trip.getId())).thenReturn(trip);
        when(accounts.capture(eq("H-1"), any())).thenReturn(new RideAccountClient.CaptureView(
                "H-1", "CAPTURED", "TX-9", TestTrips.RIDER_ACCOUNT, null, 120_000L, "KZT", false));
        Trip completed = TestTrips.completed();
        when(state.markCompleted(trip.getId(), "TX-9", TripTransition.ACTOR_DRIVER)).thenReturn(completed);

        Trip result = saga.complete(trip.getId(), TripTransition.ACTOR_DRIVER);

        assertThat(result.getStatus()).isEqualTo(TripStatus.COMPLETED);
        ArgumentCaptor<RideAccountClient.CaptureRequest> captor =
                ArgumentCaptor.forClass(RideAccountClient.CaptureRequest.class);
        verify(accounts).capture(eq("H-1"), captor.capture());
        assertThat(captor.getValue().referenceType()).isEqualTo(RideAccountClient.REFERENCE_TYPE_TRIP);
        assertThat(captor.getValue().referenceId()).isEqualTo(trip.getId());
        // The fare settles to the platform: paying the driver his share is the deferred
        // payout step, and it must not be hidden inside a capture.
        assertThat(captor.getValue().targetAccountId()).isNull();
        verify(state).markCompleted(trip.getId(), "TX-9", TripTransition.ACTOR_DRIVER);
        verify(roster).finishTrip(TestTrips.DRIVER);
    }

    @Test
    @DisplayName("a ride that never reserved a fare cannot be completed")
    void complete_without_a_reservation_is_refused() {
        Trip trip = searchingTrip();
        when(state.require(trip.getId())).thenReturn(trip);

        assertThatThrownBy(() -> saga.complete(trip.getId(), TripTransition.ACTOR_DRIVER))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_ASSIGNED));

        verifyNoInteractions(accounts, roster);
    }

    @Test
    @DisplayName("a retried completion does not charge twice")
    void a_retried_completion_does_not_capture_twice() {
        Trip completed = TestTrips.completed();
        when(state.require(completed.getId())).thenReturn(completed);

        Trip result = saga.complete(completed.getId(), TripTransition.ACTOR_DRIVER);

        assertThat(result).isSameAs(completed);
        verifyNoInteractions(accounts, roster);
    }

    @Test
    @DisplayName("a driver that could not be released does not fail a finished, charged ride")
    void a_driver_that_cannot_be_released_does_not_break_the_ride() {
        Trip trip = TestTrips.inProgress();
        when(state.require(trip.getId())).thenReturn(trip);
        when(accounts.capture(eq("H-1"), any())).thenReturn(new RideAccountClient.CaptureView(
                "H-1", "CAPTURED", "TX-9", TestTrips.RIDER_ACCOUNT, null, 120_000L, "KZT", false));
        Trip completed = TestTrips.completed();
        when(state.markCompleted(anyString(), anyString(), anyString())).thenReturn(completed);
        when(roster.finishTrip(TestTrips.DRIVER))
                .thenThrow(DomainException.unavailable("driver-service did not answer"));

        Trip result = saga.complete(trip.getId(), TripTransition.ACTOR_DRIVER);

        assertThat(result.getStatus()).isEqualTo(TripStatus.COMPLETED);
        verify(state).markCompleted(trip.getId(), "TX-9", TripTransition.ACTOR_DRIVER);
    }

    // ------------------------------------------------------------------ cancel

    @Test
    @DisplayName("the status moves before the money does: the aggregate decides, then the fare goes back")
    void cancel_changes_the_status_before_releasing_the_fare() {
        Trip trip = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(trip);
        Trip cancelledWithHold = TestTrips.cancelledWithLiveHold();
        when(state.cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, "передумал",
                TripTransition.ACTOR_RIDER)).thenReturn(cancelledWithHold);
        Trip released = TestTrips.cancelledByRider();
        when(state.markHoldReleased(cancelledWithHold.getId(), "передумал")).thenReturn(released);

        Trip result = saga.cancel(rider(), trip.getId(), "передумал", null);

        assertThat(result.getHoldStatus()).isEqualTo(TripHoldStatus.RELEASED);
        InOrder order = inOrder(state, accounts);
        order.verify(state).cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, "передумал",
                TripTransition.ACTOR_RIDER);
        order.verify(accounts).release("H-1", "передумал");
        order.verify(state).markHoldReleased(cancelledWithHold.getId(), "передумал");
        verify(roster).finishTrip(TestTrips.DRIVER);
    }

    @Test
    @DisplayName("a ride in progress cannot be cancelled, and its fare stays reserved")
    void cancel_of_a_ride_in_progress_leaves_the_fare_reserved() {
        Trip trip = TestTrips.inProgress();
        when(state.require(trip.getId())).thenReturn(trip);
        when(state.cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, "передумал",
                TripTransition.ACTOR_RIDER))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_CANCELLABLE, "the ride is IN_PROGRESS"));

        assertThatThrownBy(() -> saga.cancel(rider(), trip.getId(), "передумал", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_CANCELLABLE));

        // The whole point of the order: the money of a ride that is still owed is never
        // given back because somebody pressed a button.
        verify(accounts, never()).release(anyString(), anyString());
        verify(state, never()).markHoldReleased(anyString(), anyString());
    }

    @Test
    @DisplayName("a repeated cancellation releases a reservation the first one left behind")
    void a_repeated_cancellation_heals_a_leftover_reservation() {
        Trip cancelledWithHold = TestTrips.cancelledWithLiveHold();
        when(state.require(cancelledWithHold.getId())).thenReturn(cancelledWithHold);
        Trip released = TestTrips.cancelledByRider();
        when(state.markHoldReleased(cancelledWithHold.getId(), "передумал")).thenReturn(released);

        Trip result = saga.cancel(rider(), cancelledWithHold.getId(), "передумал", null);

        assertThat(result.getHoldStatus()).isEqualTo(TripHoldStatus.RELEASED);
        verify(accounts).release("H-1", "передумал");
        verify(state, never()).cancel(anyString(), any(), any(), anyString());
    }

    @Test
    @DisplayName("a repeated cancellation of a ride whose money is already back changes nothing")
    void a_repeated_cancellation_is_a_no_op() {
        Trip cancelled = TestTrips.cancelledByRider();
        when(state.require(cancelled.getId())).thenReturn(cancelled);

        Trip result = saga.cancel(rider(), cancelled.getId(), "передумал", null);

        assertThat(result).isSameAs(cancelled);
        verifyNoInteractions(accounts);
        verify(state, never()).cancel(anyString(), any(), any(), anyString());
    }

    @Test
    @DisplayName("a retry never gives away a ride that was performed")
    void a_retry_never_releases_the_fare_of_a_completed_ride() {
        // The hole this guard closes: a completed ride whose reservation is still ACTIVE is
        // an incident for support, not a refund — the driver did the work.
        Trip completedWithActiveHold = TestTrips.assigned();
        completedWithActiveHold.markArrived(TestTrips.NOW.plusSeconds(60));
        completedWithActiveHold.markStarted(TestTrips.NOW.plusSeconds(90));
        completedWithActiveHold.markCompleted("TX-1", TestTrips.NOW.plusSeconds(600));
        when(trips.findByIdempotencyKey(KEY)).thenReturn(Optional.of(completedWithActiveHold));

        Trip result = saga.request(rider(), order(), KEY);

        assertThat(result).isSameAs(completedWithActiveHold);
        assertThat(result.getHoldStatus()).isEqualTo(TripHoldStatus.ACTIVE);
        verifyNoInteractions(accounts, roster, finder);
    }

    @Test
    @DisplayName("the rider cancels his own ride without a reason")
    void a_rider_needs_no_reason() {
        Trip trip = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(trip);
        Trip cancelledWithHold = TestTrips.cancelledWithLiveHold();
        when(state.cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, null, TripTransition.ACTOR_RIDER))
                .thenReturn(cancelledWithHold);
        when(state.markHoldReleased(cancelledWithHold.getId(), "trip cancelled"))
                .thenReturn(TestTrips.cancelledByRider());

        saga.cancel(rider(), trip.getId(), null, null);

        verify(state).cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, null, TripTransition.ACTOR_RIDER);
        verify(accounts).release("H-1", "trip cancelled");
    }

    @Test
    @DisplayName("a dispatcher must say why he is closing somebody else's ride")
    void an_operator_must_give_a_reason() {
        Trip trip = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(trip);

        assertThatThrownBy(() -> saga.cancel(dispatcher(), trip.getId(), "   ", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.CANCEL_REASON_REQUIRED));

        verifyNoInteractions(accounts);
        verify(state, never()).cancel(anyString(), any(), any(), anyString());
    }

    @Test
    @DisplayName("a dispatcher closing a ride says whose side it came from")
    void a_dispatcher_records_the_side_he_closed() {
        Trip trip = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(trip);
        Trip cancelled = TestTrips.cancelledByRider();
        when(state.cancel(trip.getId(), TripStatus.CANCELLED_BY_DRIVER, "водитель не приехал",
                TripTransition.ACTOR_DISPATCHER)).thenReturn(cancelled);

        saga.cancel(dispatcher(), trip.getId(), "водитель не приехал", "DRIVER");

        verify(state).cancel(trip.getId(), TripStatus.CANCELLED_BY_DRIVER, "водитель не приехал",
                TripTransition.ACTOR_DISPATCHER);
    }

    @Test
    @DisplayName("a rider never cancels somebody else's ride")
    void a_stranger_cannot_cancel() {
        Trip trip = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(trip);
        AuthenticatedUser stranger =
                new AuthenticatedUser(TestTrips.OTHER_RIDER, "+77001111111", "Другой", Set.of(Roles.CUSTOMER));

        assertThatThrownBy(() -> saga.cancel(stranger, trip.getId(), "не моя поездка", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));

        verifyNoInteractions(accounts);
    }

    @Test
    @DisplayName("a merchant has no business cancelling rides")
    void a_merchant_cannot_cancel() {
        Trip trip = TestTrips.assigned();
        when(state.require(trip.getId())).thenReturn(trip);

        assertThatThrownBy(() -> saga.cancel(merchant(), trip.getId(), "не моя поездка", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));

        verifyNoInteractions(accounts);
    }

    // ------------------------------------------------------------------ rating

    @Test
    @DisplayName("the rider rates his own completed ride")
    void the_rider_rates_his_ride() {
        Trip completed = TestTrips.completed();
        when(state.require(completed.getId())).thenReturn(completed);
        when(state.rate(completed.getId(), 5, "отличный водитель", TripTransition.ACTOR_RIDER))
                .thenReturn(completed);

        saga.rate(rider(), completed.getId(), 5, "отличный водитель");

        verify(state).rate(completed.getId(), 5, "отличный водитель", TripTransition.ACTOR_RIDER);
    }

    @Test
    @DisplayName("nobody rates a ride that is not his")
    void only_the_rider_rates() {
        Trip completed = TestTrips.completed();
        when(state.require(completed.getId())).thenReturn(completed);
        AuthenticatedUser stranger =
                new AuthenticatedUser(TestTrips.OTHER_RIDER, "+77001111111", "Другой", Set.of(Roles.CUSTOMER));

        assertThatThrownBy(() -> saga.rate(stranger, completed.getId(), 1, null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));

        verify(state, never()).rate(anyString(), anyInt(), any(), anyString());
    }

    @Test
    @DisplayName("an order without an idempotency key never reaches the state service")
    void an_order_without_a_key_is_refused() {
        assertThatThrownBy(() -> saga.request(rider(), order(), "  "))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_REQUEST));

        verifyNoInteractions(state, trips, accounts, roster, finder);
    }

    @Test
    @DisplayName("only a customer orders a ride")
    void only_a_customer_orders() {
        assertThatThrownBy(() -> saga.request(merchant(), order(), KEY))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));

        verifyNoInteractions(state, trips, accounts, roster, finder);
    }
}
