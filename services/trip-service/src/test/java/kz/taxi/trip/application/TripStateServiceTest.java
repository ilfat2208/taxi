package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripHoldStatus;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.infrastructure.QuoteRepository;
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

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The durable half of the saga: one transaction per state change, each with its timeline row
 * and its event.
 *
 * <p>The point of these tests is the pairing — a status change without its event, or an event
 * without its status change, is exactly the failure the transactional outbox exists to make
 * impossible, and it is only visible when the two are asserted together.
 */
@ExtendWith(MockitoExtension.class)
class TripStateServiceTest {

    @Mock
    private TripRepository trips;
    @Mock
    private TripTransitionRepository transitions;
    @Mock
    private QuoteRepository quotes;
    @Mock
    private OutboxWriter outbox;

    private TripStateService state;

    @BeforeEach
    void setUp() {
        state = new TripStateService(trips, transitions, quotes, outbox,
                Clock.fixed(TestTrips.NOW, ZoneOffset.UTC));
    }

    private void given(Trip trip) {
        when(trips.findById(trip.getId())).thenReturn(Optional.of(trip));
        when(trips.save(any(Trip.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }

    private void givenQuote(Quote quote) {
        when(quotes.findById(quote.getId())).thenReturn(Optional.of(quote));
    }

    // ------------------------------------------------------------------ creation

    @Test
    @DisplayName("a request writes the ride, its first timeline row and the trip.requested event")
    void creating_a_ride_writes_the_row_the_timeline_and_the_event() {
        Quote quote = TestTrips.quote();
        givenQuote(quote);
        when(trips.save(any(Trip.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Trip trip = state.create(TestTrips.RIDER, quote.getId(), "idem-1", "позвоните");

        assertThat(trip.getStatus()).isEqualTo(TripStatus.SEARCHING);
        assertThat(trip.getIdempotencyKey()).isEqualTo("idem-1");
        assertThat(trip.getRiderAccountId()).isEqualTo(TestTrips.RIDER_ACCOUNT);

        ArgumentCaptor<TripTransition> transition = ArgumentCaptor.forClass(TripTransition.class);
        verify(transitions).save(transition.capture());
        assertThat(transition.getValue().getFromStatus()).isNull();
        assertThat(transition.getValue().getToStatus()).isEqualTo(TripStatus.SEARCHING);
        assertThat(transition.getValue().getActor()).isEqualTo(TripTransition.ACTOR_RIDER);
        assertThat(transition.getValue().getOccurredAt()).isEqualTo(TestTrips.NOW);

        // The quote is consumed in the same transaction: two cars from one promise would be
        // two reserved fares against one agreed price.
        assertThat(quote.isConsumed()).isTrue();
        assertThat(quote.getConsumedTripId()).isEqualTo(trip.getId());

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_REQUESTED),
                eq("Trip"), eq(trip.getId()), anyLong(), payload.capture());
        assertThat(payload.getValue()).isInstanceOf(TripEvents.TripRequested.class);
        TripEvents.TripRequested requested = (TripEvents.TripRequested) payload.getValue();
        assertThat(requested.tripId()).isEqualTo(trip.getId());
        assertThat(requested.priceMinor()).isEqualTo(trip.getPriceMinor());
        assertThat(requested.driverNetMinor() + requested.commissionMinor())
                .isEqualTo(requested.priceMinor());
    }

    @Test
    @DisplayName("a spent quote cannot produce a second ride")
    void a_spent_quote_is_refused() {
        Quote quote = TestTrips.quote();
        quote.consume("OTHER-TRIP", TestTrips.NOW);
        givenQuote(quote);

        assertThatThrownBy(() -> state.create(TestTrips.RIDER, quote.getId(), "idem-1", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_ALREADY_USED));

        verify(trips, never()).save(any(Trip.class));
    }

    @Test
    @DisplayName("an expired quote cannot produce a ride either")
    void an_expired_quote_is_refused() {
        Quote quote = TestTrips.quote(TestTrips.RIDER, Tariff.ECONOMY, TestTrips.ROUTE,
                TestTrips.NOW.minus(Duration.ofMinutes(30)), Duration.ofMinutes(5));
        givenQuote(quote);

        assertThatThrownBy(() -> state.create(TestTrips.RIDER, quote.getId(), "idem-1", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_EXPIRED));
    }

    @Test
    @DisplayName("another rider's quote cannot be used")
    void somebody_elses_quote_is_refused() {
        Quote quote = TestTrips.quote();
        givenQuote(quote);

        assertThatThrownBy(() -> state.create(TestTrips.OTHER_RIDER, quote.getId(), "idem-1", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_NOT_OWNED));
    }

    @Test
    @DisplayName("an unknown quote is a 404")
    void an_unknown_quote_is_a_404() {
        when(quotes.findById("Q-NONE")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> state.create(TestTrips.RIDER, "Q-NONE", "idem-1", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_NOT_FOUND));
    }

    // ------------------------------------------------------------------ transitions and events

    @Test
    @DisplayName("assignment publishes the event that tells the platform a car is coming")
    void assignment_publishes_the_assigned_event() {
        Trip trip = TestTrips.searching();
        given(trip);

        Trip assigned = state.markAssigned(trip.getId(), TestTrips.DRIVER, "Айдар", null,
                TripTransition.ACTOR_DISPATCHER);

        assertThat(assigned.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_DRIVER_ASSIGNED),
                eq("Trip"), eq(trip.getId()), anyLong(), payload.capture());
        assertThat(((TripEvents.TripDriverAssigned) payload.getValue()).driverId())
                .isEqualTo(TestTrips.DRIVER);
    }

    @Test
    @DisplayName("completion captures the hold, records the transaction and publishes trip.completed")
    void completion_captures_and_publishes() {
        Trip trip = TestTrips.inProgress();
        given(trip);

        Trip completed = state.markCompleted(trip.getId(), "TX-9", TripTransition.ACTOR_DRIVER);

        assertThat(completed.getStatus()).isEqualTo(TripStatus.COMPLETED);
        assertThat(completed.getHoldStatus()).isEqualTo(TripHoldStatus.CAPTURED);
        assertThat(completed.getCaptureTransactionId()).isEqualTo("TX-9");
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_COMPLETED),
                eq("Trip"), eq(trip.getId()), anyLong(), payload.capture());
        TripEvents.TripCompleted event = (TripEvents.TripCompleted) payload.getValue();
        assertThat(event.transactionId()).isEqualTo("TX-9");
        assertThat(event.driverNetMinor() + event.commissionMinor()).isEqualTo(event.priceMinor());
    }

    @Test
    @DisplayName("a cancellation publishes trip.cancelled with its reason and actor")
    void cancellation_publishes_with_its_reason() {
        Trip trip = TestTrips.assigned();
        given(trip);

        Trip cancelled = state.cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, "передумал",
                TripTransition.ACTOR_RIDER);

        assertThat(cancelled.getStatus()).isEqualTo(TripStatus.CANCELLED_BY_RIDER);
        assertThat(cancelled.getCancelReason()).isEqualTo("передумал");
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_CANCELLED),
                eq("Trip"), eq(trip.getId()), anyLong(), payload.capture());
        TripEvents.TripCancelled event = (TripEvents.TripCancelled) payload.getValue();
        assertThat(event.reason()).isEqualTo("передумал");
        assertThat(event.actor()).isEqualTo(TripTransition.ACTOR_RIDER);
        // The release happens after this transaction commits, so the event reports it
        // conservatively rather than claiming money came back before it did.
        assertThat(event.holdReleased()).isFalse();
    }

    @Test
    @DisplayName("no drivers found is published as a cancellation the rider can read")
    void no_drivers_is_published() {
        Trip trip = TestTrips.searching();
        given(trip);

        state.markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM);

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_CANCELLED),
                eq("Trip"), eq(trip.getId()), anyLong(), payload.capture());
        TripEvents.TripCancelled event = (TripEvents.TripCancelled) payload.getValue();
        assertThat(event.status()).isEqualTo(TripStatus.NO_DRIVERS_FOUND.name());
        assertThat(event.reason()).isEqualTo("NO_DRIVERS_FOUND");
    }

    @Test
    @DisplayName("arriving and starting publish their own events")
    void arriving_and_starting_publish() {
        Trip trip = TestTrips.assigned();
        when(trips.findById(trip.getId())).thenReturn(Optional.of(trip));
        when(trips.save(any(Trip.class))).thenAnswer(invocation -> invocation.getArgument(0));

        state.markArrived(trip.getId(), TripTransition.ACTOR_DRIVER);
        state.markStarted(trip.getId(), TripTransition.ACTOR_DRIVER);

        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_DRIVER_ARRIVED),
                eq("Trip"), eq(trip.getId()), anyLong(), any());
        verify(outbox).append(eq(KafkaTopics.TRIP_EVENTS), eq(KafkaTopics.Events.TRIP_STARTED),
                eq("Trip"), eq(trip.getId()), anyLong(), any());
    }

    // ------------------------------------------------------------------ money bookkeeping

    @Test
    @DisplayName("recording the release is idempotent and publishes nothing of its own")
    void marking_a_release_is_idempotent() {
        Trip trip = TestTrips.assigned();
        given(trip);

        Trip released = state.markHoldReleased(trip.getId(), "передумал");
        Trip releasedAgain = state.markHoldReleased(trip.getId(), "передумал");

        assertThat(released.getHoldStatus()).isEqualTo(TripHoldStatus.RELEASED);
        assertThat(releasedAgain.getHoldStatus()).isEqualTo(TripHoldStatus.RELEASED);
        // The money side publishes account.hold.released on its own topic; this service does
        // not invent a second event for a fact it does not own.
        verify(outbox, never()).append(any(), any(), any(), any(), anyLong(), any());
        verify(transitions, never()).save(any(TripTransition.class));
    }

    @Test
    @DisplayName("a release with nothing reserved changes nothing and is not an error")
    void a_release_without_a_reservation_is_a_no_op() {
        Trip trip = TestTrips.searching();
        when(trips.findById(trip.getId())).thenReturn(Optional.of(trip));

        Trip result = state.markHoldReleased(trip.getId(), "нечего возвращать");

        assertThat(result.getHoldStatus()).isEqualTo(TripHoldStatus.NONE);
        verify(trips, never()).save(any(Trip.class));
        verify(transitions, never()).save(any(TripTransition.class));
    }

    // ------------------------------------------------------------------ rating

    @Test
    @DisplayName("a rating is recorded in the timeline and published to nobody")
    void a_rating_is_recorded_but_not_published() {
        Trip trip = TestTrips.completed();
        given(trip);

        Trip rated = state.rate(trip.getId(), 5, "отличный водитель", TripTransition.ACTOR_RIDER);

        assertThat(rated.getRatingStars()).isEqualTo(5);
        assertThat(rated.getRatingComment()).isEqualTo("отличный водитель");
        verify(outbox, never()).append(any(), any(), any(), any(), anyLong(), any());
        ArgumentCaptor<TripTransition> transition = ArgumentCaptor.forClass(TripTransition.class);
        verify(transitions).save(transition.capture());
        assertThat(transition.getValue().getReason()).isEqualTo("rated");
    }

    @Test
    @DisplayName("an unknown ride is a 404 rather than a null")
    void an_unknown_ride_is_a_404() {
        when(trips.findById("TRIP-NONE")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> state.require("TRIP-NONE"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_FOUND));
    }
}
