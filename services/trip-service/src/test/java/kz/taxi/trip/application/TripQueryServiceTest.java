package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.infrastructure.TripProperties;
import kz.taxi.trip.infrastructure.TripRepository;
import kz.taxi.trip.infrastructure.TripTransitionRepository;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who sees which rides.
 *
 * <p>Each caller is checked against its own repository method rather than against a shared
 * query with a filter: "a rider's history" and "the dispatcher's board" are different sets,
 * and the test that matters most is the one proving a customer's filter can never widen his
 * own ride to somebody else's.
 */
@ExtendWith(MockitoExtension.class)
class TripQueryServiceTest {

    private static final String TRIP_ID = "01HTRIP000000000000000001";

    @Mock
    private TripRepository trips;
    @Mock
    private TripTransitionRepository transitions;

    private TripQueryService queries;

    @BeforeEach
    void setUp() {
        queries = new TripQueryService(trips, transitions, new TripProperties());
    }

    private static AuthenticatedUser customer() {
        return new AuthenticatedUser(TestTrips.RIDER, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    }

    private static AuthenticatedUser dispatcher() {
        return new AuthenticatedUser("U-DISP", "+77009999999", "Диспетчер", Set.of(Roles.DISPATCHER));
    }

    private static AuthenticatedUser support() {
        return new AuthenticatedUser("U-SUP", "+77007777777", "Оператор", Set.of(Roles.SUPPORT));
    }

    private static AuthenticatedUser admin() {
        return new AuthenticatedUser("U-ADM", "+77006666666", "Админ", Set.of(Roles.ADMIN));
    }

    private Page<Trip> pageOf(Trip trip) {
        return new PageImpl<>(List.of(trip), PageRequest.of(0, 20), 1);
    }

    // ------------------------------------------------------------------ the rider's own list

    @Test
    @DisplayName("a customer sees his own rides and only his own")
    void a_customer_sees_his_own_rides() {
        Trip trip = TestTrips.completed();
        when(trips.findByRiderUserIdOrderByRequestedAtDesc(eq(TestTrips.RIDER), any(Pageable.class)))
                .thenReturn(pageOf(trip));

        PageResponse<Trip> result = queries.list(customer(), null, 0, 20);

        assertThat(result.items()).containsExactly(trip);
        assertThat(result.totalElements()).isEqualTo(1);
        verify(trips).findByRiderUserIdOrderByRequestedAtDesc(eq(TestTrips.RIDER), any(Pageable.class));
        verify(trips, never()).findAllByOrderByRequestedAtDesc(any(Pageable.class));
    }

    @Test
    @DisplayName("a customer's status filter narrows his own rides, it never widens them")
    void a_customer_filter_stays_inside_his_own_rides() {
        when(trips.findByRiderUserIdAndStatusOrderByRequestedAtDesc(eq(TestTrips.RIDER),
                eq(TripStatus.COMPLETED), any(Pageable.class)))
                .thenReturn(pageOf(TestTrips.completed()));

        queries.list(customer(), TripStatus.COMPLETED, 0, 20);

        // The ownership clause is part of the query, not a parameter: there is no argument a
        // client could send that would return somebody else's ride.
        verify(trips).findByRiderUserIdAndStatusOrderByRequestedAtDesc(eq(TestTrips.RIDER),
                eq(TripStatus.COMPLETED), any(Pageable.class));
        verify(trips, never()).findByStatusOrderByRequestedAtDesc(any(TripStatus.class), any(Pageable.class));
    }

    // ------------------------------------------------------------------ the board

    @Test
    @DisplayName("a dispatcher's board is every live request, newest first")
    void a_dispatcher_sees_the_live_board() {
        when(trips.findByStatusInOrderByRequestedAtDesc(any(), any(Pageable.class)))
                .thenReturn(pageOf(TestTrips.assigned()));

        queries.list(dispatcher(), null, 0, 20);

        verify(trips).findByStatusInOrderByRequestedAtDesc(eq(TripStatus.live()), any(Pageable.class));
        assertThat(TripStatus.live()).containsExactlyInAnyOrder(TripStatus.SEARCHING, TripStatus.ASSIGNED,
                TripStatus.ARRIVED, TripStatus.IN_PROGRESS);
    }

    @Test
    @DisplayName("a dispatcher can narrow the board to one status, including a finished one")
    void a_dispatcher_can_ask_for_one_status() {
        when(trips.findByStatusOrderByRequestedAtDesc(eq(TripStatus.NO_DRIVERS_FOUND), any(Pageable.class)))
                .thenReturn(pageOf(TestTrips.noDriversFound()));

        queries.list(dispatcher(), TripStatus.NO_DRIVERS_FOUND, 0, 20);

        verify(trips).findByStatusOrderByRequestedAtDesc(eq(TripStatus.NO_DRIVERS_FOUND), any(Pageable.class));
    }

    @Test
    @DisplayName("support and an operator see every ride, any status")
    void support_and_operators_see_everything() {
        when(trips.findAllByOrderByRequestedAtDesc(any(Pageable.class))).thenReturn(pageOf(TestTrips.completed()));

        queries.list(support(), null, 0, 20);
        queries.list(admin(), null, 0, 20);

        verify(trips, times(2)).findAllByOrderByRequestedAtDesc(any(Pageable.class));
    }

    @Test
    @DisplayName("a driver or a merchant has no list at all")
    void another_role_has_no_list() {
        AuthenticatedUser driver = new AuthenticatedUser("U-DRV", null, "Айдар", Set.of(Roles.DRIVER));

        assertThatThrownBy(() -> queries.list(driver, null, 0, 20))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));
    }

    @Test
    @DisplayName("the page size is capped, and a missing one means the configured default")
    void the_page_size_is_capped() {
        TripProperties properties = new TripProperties();
        when(trips.findByRiderUserIdOrderByRequestedAtDesc(anyString(), any(Pageable.class)))
                .thenReturn(pageOf(TestTrips.completed()));

        queries.list(customer(), null, -3, 0);
        queries.list(customer(), null, 0, 10_000);

        ArgumentCaptor<Pageable> captor = ArgumentCaptor.forClass(Pageable.class);
        verify(trips, times(2))
                .findByRiderUserIdOrderByRequestedAtDesc(eq(TestTrips.RIDER), captor.capture());
        assertThat(captor.getAllValues().get(0).getPageSize()).isEqualTo(properties.getPageSizeDefault());
        assertThat(captor.getAllValues().get(0).getPageNumber()).isZero();
        assertThat(captor.getAllValues().get(1).getPageSize()).isEqualTo(properties.getPageSizeMax());
    }

    // ------------------------------------------------------------------ one ride

    @Test
    @DisplayName("a ride is visible to its rider, to support and to an operator")
    void one_ride_is_visible_to_its_riders_side() {
        Trip trip = TestTrips.completed();
        when(trips.findById(TRIP_ID)).thenReturn(Optional.of(trip));
        when(transitions.findByTripIdOrderByOccurredAtAscIdAsc(TRIP_ID)).thenReturn(List.of());

        assertThat(queries.details(customer(), TRIP_ID).trip()).isSameAs(trip);
        assertThat(queries.details(support(), TRIP_ID).trip()).isSameAs(trip);
        assertThat(queries.details(admin(), TRIP_ID).trip()).isSameAs(trip);
    }

    @Test
    @DisplayName("somebody else's ride is refused, not returned")
    void another_riders_ride_is_forbidden() {
        Trip trip = TestTrips.completed();
        when(trips.findById(TRIP_ID)).thenReturn(Optional.of(trip));
        AuthenticatedUser stranger =
                new AuthenticatedUser(TestTrips.OTHER_RIDER, "+77001111111", "Другой", Set.of(Roles.CUSTOMER));

        assertThatThrownBy(() -> queries.details(stranger, TRIP_ID))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));
    }

    @Test
    @DisplayName("an unknown ride is a 404 with the id in the details")
    void an_unknown_ride_is_a_404() {
        when(trips.findById(TRIP_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> queries.details(customer(), TRIP_ID))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_FOUND);
                    assertThat(ex.details()).containsEntry("tripId", TRIP_ID);
                });
    }

    @Test
    @DisplayName("the internal read needs no owner: the caller is a workload")
    void the_internal_read_needs_no_owner() {
        Trip trip = TestTrips.assigned();
        when(trips.findById(TRIP_ID)).thenReturn(Optional.of(trip));
        when(transitions.findByTripIdOrderByOccurredAtAscIdAsc(TRIP_ID)).thenReturn(List.of());

        TripDetails details = queries.internalDetails(TRIP_ID);

        assertThat(details.trip()).isSameAs(trip);
        assertThat(details.receiptOrNull()).isNull();
    }

    @Test
    @DisplayName("a live ride has no check, a completed one does — from the same builder")
    void the_receipt_follows_the_status() {
        Trip live = TestTrips.inProgress();
        when(trips.findById(TRIP_ID)).thenReturn(Optional.of(live));
        assertThatThrownBy(() -> queries.receipt(customer(), TRIP_ID))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_COMPLETED));

        Trip completed = TestTrips.completed();
        when(trips.findById(TRIP_ID)).thenReturn(Optional.of(completed));

        assertThat(queries.receipt(customer(), TRIP_ID).priceMinor()).isEqualTo(completed.getPriceMinor());
        assertThat(queries.details(customer(), TRIP_ID).receiptOrNull()).isNotNull();
    }
}
