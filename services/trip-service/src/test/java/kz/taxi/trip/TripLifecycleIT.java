package kz.taxi.trip;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxMessage;
import kz.taxi.common.kafka.outbox.OutboxRepository;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.application.TripSagaService;
import kz.taxi.trip.application.TripStateService;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripHoldStatus;
import kz.taxi.trip.domain.TripReceipt;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.infrastructure.QuoteRepository;
import kz.taxi.trip.infrastructure.TripRepository;
import kz.taxi.trip.infrastructure.TripTransitionRepository;
import kz.taxi.trip.infrastructure.client.DriverFinder;
import kz.taxi.trip.infrastructure.client.DriverRoster;
import kz.taxi.trip.infrastructure.client.RideAccountClient;
import kz.taxi.trip.support.ItInfrastructure;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The ride lifecycle against a real PostgreSQL 16, the real Flyway migrations and the real
 * transactions — including the two windows where a search and a dispatcher can disagree.
 *
 * <p><strong>What is stubbed:</strong> only the three counterparts. Account, dispatch and
 * driver services are in-memory doubles that record what they were asked to do, so the
 * assertions can be about money: which hold exists, which one was captured, which one was
 * released. Everything else is real — the frozen schema with its CHECK constraints, Hibernate
 * validating the mappings against it, the aggregate, the transactional steps and the outbox
 * rows (the relay is switched off, so the row itself is asserted rather than racing a
 * publisher: the row is the guarantee, Kafka is only the delivery).
 *
 * <p><strong>Why the races are here and not in a unit test.</strong> The windows this class
 * exists for are windows between two transactions, and a "consistent state" assertion is only
 * meaningful against a real schema: <em>either the ride is alive and its fare is reserved, or
 * the ride is closed and the reservation is gone</em>. The stubs are the interleaving
 * mechanism — a counterpart that decides something else in the middle of a call is exactly
 * what a second replica or a dispatcher's console does at that moment.
 *
 * <p>Runs only with {@code -Pintegration} (failsafe, {@code *IT}); without a usable Docker and
 * without {@code IT_DATABASE_URL} the class is reported as skipped.
 */
@EnabledIf(ItInfrastructure.AVAILABLE_METHOD)
@SpringBootTest(properties = {
        "taxi.outbox.enabled=false",
        "taxi.idempotency.store=memory",
        "taxi.kafka.dedup.store=memory",
        "spring.kafka.admin.fail-fast=false"
})
class TripLifecycleIT {

    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"));

    private static final ItInfrastructure INFRASTRUCTURE = ItInfrastructure.start(POSTGRES);

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        INFRASTRUCTURE.register(registry);
    }

    private static final String RIDER = "U-RIDER";
    private static final String RIDER_ACCOUNT = "A-RIDER";

    @TestConfiguration
    static class StubbedCounterparts {

        @Bean
        @Primary
        StubRideAccountClient stubRideAccountClient() {
            return new StubRideAccountClient();
        }

        @Bean
        @Primary
        StubDriverFinder stubDriverFinder() {
            return new StubDriverFinder();
        }

        @Bean
        @Primary
        StubDriverRoster stubDriverRoster() {
            return new StubDriverRoster();
        }
    }

    @Autowired
    private TripSagaService saga;
    @Autowired
    private TripStateService state;
    @Autowired
    private QuoteRepository quotes;
    @Autowired
    private TripRepository trips;
    @Autowired
    private TripTransitionRepository transitions;
    @Autowired
    private OutboxRepository outbox;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private StubRideAccountClient accounts;
    @Autowired
    private StubDriverFinder finder;
    @Autowired
    private StubDriverRoster roster;

    @BeforeEach
    void clean() {
        // Both the rides and the events: the outbox rows are the assertion, so a row left by
        // the previous scenario would make this one pass for the wrong reason.
        jdbc.execute("delete from trip.trip_transition");
        jdbc.execute("delete from trip.trip");
        jdbc.execute("delete from trip.quote");
        jdbc.execute("delete from trip.outbox_message");
        accounts.reset();
        finder.reset();
        roster.reset();
    }

    private static AuthenticatedUser rider() {
        return new AuthenticatedUser(RIDER, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    }

    private static AuthenticatedUser dispatcher() {
        return new AuthenticatedUser("U-DISP", "+77009999999", "Диспетчер", Set.of(Roles.DISPATCHER));
    }

    /** A quote as the quote service would have stored it: priced, anchored, unspent. */
    private Quote givenQuote() {
        return quotes.save(Quote.issue(RIDER, RIDER_ACCOUNT, kz.taxi.trip.domain.Tariff.ECONOMY,
                43.2389d, 76.8897d, "Абая 150", 43.2489d, 76.8897d, "Достык 5",
                Currency.KZT, TestTrips.fare(kz.taxi.trip.domain.Tariff.ECONOMY, TestTrips.ROUTE),
                Instant.now(), java.time.Duration.ofMinutes(5)));
    }

    private Trip givenSearching() {
        Trip trip = state.create(RIDER, givenQuote().getId(), "idem-1", null);
        return trip;
    }

    private void givenOneCandidate() {
        finder.candidates = List.of(new DriverFinder.Candidate("D-1", "Айдар", 250d, 43.24d, 76.89d, 2L));
    }

    private TripDtos.CreateTripRequest order(String quoteId) {
        return new TripDtos.CreateTripRequest(quoteId, null);
    }

    private long outboxRows(String eventType) {
        return outbox.findAll().stream()
                .filter(message -> eventType.equals(message.getEventType()))
                .count();
    }

    private List<String> outboxTopics() {
        return outbox.findAll().stream().map(OutboxMessage::getTopic).distinct().toList();
    }

    private String holdStatusInDb(String tripId) {
        return jdbc.queryForObject("select hold_status from trip.trip where id = ?", String.class, tripId);
    }

    private String statusInDb(String tripId) {
        return jdbc.queryForObject("select status from trip.trip where id = ?", String.class, tripId);
    }

    // ------------------------------------------------------------------ the happy path

    @Test
    @DisplayName("a whole ride: requested, assigned, arrived, started, completed — with the fare captured once")
    void a_whole_ride_runs_to_a_captured_fare() {
        givenOneCandidate();
        String quoteId = givenQuote().getId();

        Trip requested = saga.request(rider(), order(quoteId), "idem-1");

        assertThat(requested.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        assertThat(requested.getDriverId()).isEqualTo("D-1");
        assertThat(requested.getDriverName()).isEqualTo("Айдар");
        assertThat(requested.getHoldId()).isNotNull();
        assertThat(holdStatusInDb(requested.getId())).isEqualTo("ACTIVE");
        assertThat(accounts.activeHolds()).containsEntry(requested.getId(), requested.getPriceMinor());
        assertThat(roster.busy).contains("D-1");
        assertThat(outboxRows(KafkaTopics.Events.TRIP_REQUESTED)).isEqualTo(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_DRIVER_ASSIGNED)).isEqualTo(1);
        assertThat(outboxTopics()).containsExactly(KafkaTopics.TRIP_EVENTS);

        saga.arrive(requested.getId(), TripTransition.ACTOR_DRIVER);
        saga.start(requested.getId(), TripTransition.ACTOR_DRIVER);
        Trip completed = saga.complete(requested.getId(), TripTransition.ACTOR_DRIVER);

        assertThat(completed.getStatus()).isEqualTo(TripStatus.COMPLETED);
        assertThat(holdStatusInDb(completed.getId())).isEqualTo("CAPTURED");
        assertThat(accounts.activeHolds()).doesNotContainKey(completed.getId());
        assertThat(accounts.capturedHoldIds()).containsExactly(completed.getHoldId());
        assertThat(accounts.capturedAmount(completed.getHoldId())).isEqualTo(completed.getPriceMinor());
        assertThat(roster.busy).doesNotContain("D-1");

        // The check of the ride, built from the row the database actually holds.
        TripReceipt receipt = TripReceipt.of(trips.findById(completed.getId()).orElseThrow());
        assertThat(receipt.breakdown().totalMinor()).isEqualTo(receipt.priceMinor());
        assertThat(receipt.driverNetMinor() + receipt.commissionMinor()).isEqualTo(receipt.priceMinor());
        assertThat(receipt.transactionId()).isNotNull();

        assertThat(outboxRows(KafkaTopics.Events.TRIP_DRIVER_ARRIVED)).isEqualTo(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_STARTED)).isEqualTo(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_COMPLETED)).isEqualTo(1);
        assertThat(transitions.findByTripIdOrderByOccurredAtAscIdAsc(completed.getId()))
                .extracting(TripTransition::getToStatus)
                .containsExactly(TripStatus.SEARCHING, TripStatus.ASSIGNED, TripStatus.ARRIVED,
                        TripStatus.IN_PROGRESS, TripStatus.COMPLETED);
    }

    @Test
    @DisplayName("a retried completion captures nothing a second time")
    void a_repeated_completion_does_not_capture_twice() {
        givenOneCandidate();
        Trip trip = saga.request(rider(), order(givenQuote().getId()), "idem-1");
        saga.arrive(trip.getId(), TripTransition.ACTOR_DRIVER);
        saga.start(trip.getId(), TripTransition.ACTOR_DRIVER);
        saga.complete(trip.getId(), TripTransition.ACTOR_DRIVER);

        Trip again = saga.complete(trip.getId(), TripTransition.ACTOR_DRIVER);

        assertThat(again.getStatus()).isEqualTo(TripStatus.COMPLETED);
        assertThat(accounts.capturedHoldIds()).hasSize(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_COMPLETED)).isEqualTo(1);
    }

    // ------------------------------------------------------------------ the race windows

    @Test
    @DisplayName("the search closing the ride while a car is being claimed leaves no money behind")
    void a_ride_closed_during_the_claim_releases_the_fare() {
        givenOneCandidate();
        Quote quote = givenQuote();
        Trip trip = state.create(RIDER, quote.getId(), "idem-1", null);
        String tripId = trip.getId();

        // The interleaving: while the saga is claiming D-1, another replica (or the same one,
        // in a previous attempt) closes this very request as having found nobody.
        roster.beforeClaim = () -> state.markNoDriversFound(tripId, TripTransition.ACTOR_SYSTEM);

        Trip result = saga.request(rider(), order(quote.getId()), "idem-1");

        // Consistent state: the ride is closed, and neither the rider's money nor the car is
        // held for a ride nobody will perform.
        assertThat(result.getStatus()).isEqualTo(TripStatus.NO_DRIVERS_FOUND);
        assertThat(statusInDb(tripId)).isEqualTo("NO_DRIVERS_FOUND");
        assertThat(holdStatusInDb(tripId)).isEqualTo("RELEASED");
        assertThat(accounts.activeHolds()).doesNotContainKey(tripId);
        assertThat(roster.busy).isEmpty();
    }

    @Test
    @DisplayName("a dispatcher's car winning the race keeps the ride alive and its fare reserved")
    void a_ride_assigned_during_the_claim_keeps_its_reservation() {
        givenOneCandidate();
        Quote quote = givenQuote();
        Trip trip = state.create(RIDER, quote.getId(), "idem-1", null);
        String tripId = trip.getId();

        // The interleaving: the dispatcher puts D-B on this request between the search's
        // reservation and its own claim of D-1.
        roster.beforeClaim = () -> state.markAssigned(tripId, "D-B", "Ерлан", null,
                TripTransition.ACTOR_DISPATCHER);

        Trip result = saga.request(rider(), order(quote.getId()), "idem-1");

        // Consistent state on the other side of the fork: the ride that exists now is the
        // dispatcher's and keeps its reservation; the car the search claimed for a ride it did
        // not get is given back. The rider is told what his ride is, not that a race happened.
        assertThat(result.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        assertThat(result.getDriverId()).isEqualTo("D-B");
        assertThat(holdStatusInDb(tripId)).isEqualTo("ACTIVE");
        assertThat(accounts.activeHolds()).containsKey(tripId);
        assertThat(roster.busy).doesNotContain("D-1");
    }

    @Test
    @DisplayName("cancelling a ride in progress is refused and its fare stays reserved")
    void a_cancellation_during_the_ride_is_refused_and_the_fare_stays() {
        givenOneCandidate();
        Trip trip = saga.request(rider(), order(givenQuote().getId()), "idem-1");
        saga.arrive(trip.getId(), TripTransition.ACTOR_DRIVER);
        saga.start(trip.getId(), TripTransition.ACTOR_DRIVER);

        assertThatThrownBy(() -> saga.cancel(rider(), trip.getId(), "передумал", null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.TRIP_NOT_CANCELLABLE));

        // The whole point of moving the status before the money: a refused cancellation does
        // not touch the reservation, so the ride can still be completed and charged.
        assertThat(statusInDb(trip.getId())).isEqualTo("IN_PROGRESS");
        assertThat(holdStatusInDb(trip.getId())).isEqualTo("ACTIVE");
        assertThat(accounts.activeHolds()).containsKey(trip.getId());
        assertThat(accounts.releasedHoldIds()).isEmpty();

        Trip completed = saga.complete(trip.getId(), TripTransition.ACTOR_DRIVER);
        assertThat(completed.getStatus()).isEqualTo(TripStatus.COMPLETED);
        assertThat(accounts.capturedAmount(completed.getHoldId())).isEqualTo(completed.getPriceMinor());
    }

    @Test
    @DisplayName("cancelling a ride that has not started gives the money back, and repeating it is safe")
    void a_cancellation_releases_the_fare_and_repeats_safely() {
        givenOneCandidate();
        Trip trip = saga.request(rider(), order(givenQuote().getId()), "idem-1");

        Trip cancelled = saga.cancel(rider(), trip.getId(), "передумал", null);

        assertThat(cancelled.getStatus()).isEqualTo(TripStatus.CANCELLED_BY_RIDER);
        assertThat(holdStatusInDb(trip.getId())).isEqualTo("RELEASED");
        assertThat(accounts.activeHolds()).doesNotContainKey(trip.getId());
        assertThat(accounts.releasedHoldIds()).containsExactly(trip.getHoldId());
        assertThat(roster.busy).doesNotContain("D-1");
        assertThat(outboxRows(KafkaTopics.Events.TRIP_CANCELLED)).isEqualTo(1);

        Trip again = saga.cancel(rider(), trip.getId(), "передумал", null);

        assertThat(again.getStatus()).isEqualTo(TripStatus.CANCELLED_BY_RIDER);
        assertThat(accounts.releasedHoldIds()).hasSize(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_CANCELLED)).isEqualTo(1);
    }

    @Test
    @DisplayName("a cancelled ride that still holds money is healed by repeating the cancellation")
    void a_leftover_reservation_is_healed_by_a_repeat() {
        givenOneCandidate();
        Trip trip = saga.request(rider(), order(givenQuote().getId()), "idem-1");
        saga.cancel(rider(), trip.getId(), "передумал", null);

        // The crash window, made visible: the cancellation committed, the release did not
        // happen (the row says ACTIVE while the account service still holds the fare). A test
        // cannot reach this state through the API — that is exactly why it is written here.
        jdbc.update("update trip.trip set hold_status = 'ACTIVE' where id = ?", trip.getId());
        accounts.holdActive(trip.getId(), trip.getHoldId(), trip.getPriceMinor());

        Trip healed = saga.cancel(rider(), trip.getId(), "передумал", null);

        assertThat(healed.getHoldStatus()).isEqualTo(TripHoldStatus.RELEASED);
        assertThat(holdStatusInDb(trip.getId())).isEqualTo("RELEASED");
        assertThat(accounts.activeHolds()).doesNotContainKey(trip.getId());
        assertThat(accounts.releasedHoldIds()).contains(trip.getHoldId());
    }

    @Test
    @DisplayName("a dispatcher's assign reserves the fare, claims the car and survives a repeat")
    void a_dispatcher_assignment_is_idempotent() {
        Trip trip = givenSearching();

        Trip assigned = saga.assign(trip.getId(), "D-1", "Айдар", null, TripTransition.ACTOR_DISPATCHER);

        assertThat(assigned.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        assertThat(holdStatusInDb(trip.getId())).isEqualTo("ACTIVE");
        assertThat(accounts.activeHolds()).containsEntry(trip.getId(), trip.getPriceMinor());
        assertThat(outboxRows(KafkaTopics.Events.TRIP_DRIVER_ASSIGNED)).isEqualTo(1);

        Trip again = saga.assign(trip.getId(), "D-1", "Айдар", null, TripTransition.ACTOR_DISPATCHER);

        assertThat(again.getStatus()).isEqualTo(TripStatus.ASSIGNED);
        assertThat(accounts.placeHoldCalls()).isEqualTo(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_DRIVER_ASSIGNED)).isEqualTo(1);
        assertThat(transitions.findByTripIdOrderByOccurredAtAscIdAsc(trip.getId()))
                .extracting(TripTransition::getToStatus)
                .containsExactly(TripStatus.SEARCHING, TripStatus.ASSIGNED);
    }

    @Test
    @DisplayName("no car in the city is a closed ride with no money moved at all")
    void no_cars_moves_no_money() {
        finder.candidates = List.of();

        Trip trip = saga.request(rider(), order(givenQuote().getId()), "idem-1");

        assertThat(trip.getStatus()).isEqualTo(TripStatus.NO_DRIVERS_FOUND);
        assertThat(holdStatusInDb(trip.getId())).isEqualTo("NONE");
        assertThat(accounts.placeHoldCalls()).isZero();
        assertThat(accounts.activeHolds()).isEmpty();
        assertThat(outboxRows(KafkaTopics.Events.TRIP_REQUESTED)).isEqualTo(1);
        assertThat(outboxRows(KafkaTopics.Events.TRIP_CANCELLED)).isEqualTo(1);
    }

    @Test
    @DisplayName("a wallet that refuses closes the ride on the rider's side and leaves no hold")
    void an_insufficient_wallet_closes_the_ride() {
        givenOneCandidate();
        accounts.refuseHoldsWith(DomainException.of(TripErrorCode.INSUFFICIENT_FUNDS,
                "not enough available funds"));

        assertThatThrownBy(() -> saga.request(rider(), order(givenQuote().getId()), "idem-1"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INSUFFICIENT_FUNDS));

        Map<String, Object> row = jdbc.queryForMap(
                "select status, cancel_reason, hold_status from trip.trip");
        assertThat(row.get("status")).isEqualTo("CANCELLED_BY_RIDER");
        assertThat(row.get("cancel_reason")).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(row.get("hold_status")).isEqualTo("NONE");
        assertThat(accounts.activeHolds()).isEmpty();
        assertThat(roster.busy).isEmpty();
    }

    // ------------------------------------------------------------------ stubs

    /** The account service as this saga uses it: holds, one capture, releases. */
    static class StubRideAccountClient implements RideAccountClient {

        private final Map<String, String> activeByTrip = new ConcurrentHashMap<>();
        private final Map<String, Long> amounts = new ConcurrentHashMap<>();
        private final List<String> released = new ArrayList<>();
        private final List<String> captured = new ArrayList<>();
        private int placeHoldCalls;
        private DomainException refusal;

        void reset() {
            activeByTrip.clear();
            amounts.clear();
            released.clear();
            captured.clear();
            placeHoldCalls = 0;
            refusal = null;
        }

        void refuseHoldsWith(DomainException failure) {
            this.refusal = failure;
        }

        /** Re-creates a hold that exists on the money side but not in the trip row. */
        void holdActive(String tripId, String holdId, long amountMinor) {
            activeByTrip.put(tripId, holdId);
            amounts.put(holdId, amountMinor);
        }

        Map<String, Long> activeHolds() {
            Map<String, Long> byTrip = new ConcurrentHashMap<>();
            activeByTrip.forEach((tripId, holdId) -> byTrip.put(tripId, amounts.get(holdId)));
            return byTrip;
        }

        List<String> releasedHoldIds() {
            return List.copyOf(released);
        }

        List<String> capturedHoldIds() {
            return List.copyOf(captured);
        }

        long capturedAmount(String holdId) {
            return amounts.getOrDefault(holdId, 0L);
        }

        int placeHoldCalls() {
            return placeHoldCalls;
        }

        @Override
        public ResolvedAccount resolveByPhone(String phone, Currency currency) {
            return new ResolvedAccount(RIDER_ACCOUNT, RIDER, currency.name(), "ACTIVE");
        }

        @Override
        public Optional<HoldView> findActiveHold(String referenceType, String referenceId, String accountId) {
            String holdId = activeByTrip.get(referenceId);
            return holdId == null
                    ? Optional.empty()
                    : Optional.of(new HoldView(holdId, accountId, amounts.get(holdId), "KZT", "ACTIVE",
                            1_000_000L, Instant.now().plusSeconds(900), false));
        }

        @Override
        public HoldView placeHold(HoldRequest request) {
            placeHoldCalls++;
            if (refusal != null) {
                throw refusal;
            }
            // Ids are ULIDs, like the account service's own: the trip schema stores them in
            // varchar(26), and a hand-made id would fail the insert rather than the assertion.
            String holdId = Ulid.nextId();
            activeByTrip.put(request.referenceId(), holdId);
            amounts.put(holdId, request.amountMinor());
            return new HoldView(holdId, request.accountId(), request.amountMinor(), "KZT", "ACTIVE",
                    1_000_000L - request.amountMinor(), Instant.now().plusSeconds(900), false);
        }

        @Override
        public CaptureView capture(String holdId, CaptureRequest request) {
            captured.add(holdId);
            activeByTrip.values().remove(holdId);
            return new CaptureView(holdId, "CAPTURED", Ulid.nextId(), RIDER_ACCOUNT, null,
                    amounts.getOrDefault(holdId, 0L), "KZT", false);
        }

        @Override
        public void release(String holdId, String reason) {
            released.add(holdId);
            activeByTrip.values().remove(holdId);
        }
    }

    /** Dispatch: a fixed candidate list, so a test decides what the city looks like. */
    static class StubDriverFinder implements DriverFinder {

        private List<Candidate> candidates = List.of();

        void reset() {
            candidates = List.of();
        }

        @Override
        public List<Candidate> nearest(double lat, double lon, int radiusM, int limit) {
            return candidates;
        }
    }

    /**
     * driver-service: a set of busy drivers, plus the one hook a test needs to interleave.
     *
     * <p>{@code beforeClaim} runs at the exact moment a car is being claimed — between the
     * reservation and the assignment — which is the window the race tests are about.
     */
    static class StubDriverRoster implements DriverRoster {

        private final Set<String> busy = ConcurrentHashMap.newKeySet();
        private Runnable beforeClaim = () -> {
        };

        void reset() {
            busy.clear();
            beforeClaim = () -> {
            };
        }

        @Override
        public DriverView assignTrip(String driverId, String tripId) {
            beforeClaim.run();
            if (!busy.add(driverId)) {
                throw DomainException.of(TripErrorCode.DRIVER_NOT_AVAILABLE, "driver {} is busy", driverId);
            }
            return new DriverView(driverId, "Айдар", "BUSY", tripId, false);
        }

        @Override
        public DriverView finishTrip(String driverId) {
            busy.remove(driverId);
            return new DriverView(driverId, "Айдар", "ONLINE", null, true);
        }
    }
}
