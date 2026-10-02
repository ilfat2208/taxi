package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripHoldStatus;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.infrastructure.QuoteRepository;
import kz.taxi.trip.infrastructure.TripRepository;
import kz.taxi.trip.infrastructure.TripTransitionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

/**
 * The durable half of the ride: one transaction per state change, each with its
 * timeline row and its event.
 *
 * <p>Separated from {@link TripSagaService} for one reason, and it is not tidiness: a
 * saga makes remote calls that fail, and a business failure must be able to leave a
 * committed trace (<em>"this request was refused on price and is closed"</em>) rather
 * than a rollback that erases the fact that the rider ever asked. A single
 * {@code @Transactional} orchestration method cannot do both — throwing the 422 that
 * the rider needs would roll back the very row that records the refusal.
 *
 * <p>So the rule is: this class never talks to another service, and the saga never
 * commits anything itself. Every method here is a short transaction whose only job is
 * "change the trip, write what changed, queue the event" — the invariant the outbox
 * exists to protect.
 */
@Service
@Slf4j
public class TripStateService {

    private final TripRepository trips;
    private final TripTransitionRepository transitions;
    private final QuoteRepository quotes;
    private final OutboxWriter outboxWriter;
    private final Clock clock;

    public TripStateService(TripRepository trips,
                            TripTransitionRepository transitions,
                            QuoteRepository quotes,
                            OutboxWriter outboxWriter,
                            Clock clock) {
        this.trips = trips;
        this.transitions = transitions;
        this.quotes = quotes;
        this.outboxWriter = outboxWriter;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ creation

    /**
     * Creates the trip from a quote and announces it.
     *
     * <p>The quote is validated and consumed here, inside the transaction, rather than
     * before it: a quote that was usable when the saga looked at it and is expired or
     * spent when the trip is written must fail the write, not produce a trip priced by
     * a promise that had already run out.
     */
    @Transactional
    public Trip create(String riderUserId, String quoteId, String idempotencyKey, String comment) {
        Instant now = clock.instant();
        Quote quote = quotes.findById(quoteId)
                .orElseThrow(() -> DomainException.of(TripErrorCode.QUOTE_NOT_FOUND,
                        "quote {} not found", quoteId).withDetail("quoteId", quoteId));
        if (!quote.getRiderUserId().equals(riderUserId)) {
            throw DomainException.of(TripErrorCode.QUOTE_NOT_OWNED,
                            "quote {} belongs to another rider", quoteId)
                    .withDetail("quoteId", quoteId);
        }
        quote.requireUsable(now);

        Trip trip = trips.save(Trip.request(riderUserId, quote, idempotencyKey, comment, now));
        // The quote is single-use: two cars from one promise would mean two fares
        // reserved against one agreed price.
        quote.consume(trip.getId(), now);

        record(trip, null, TripStatus.SEARCHING, TripTransition.ACTOR_RIDER, "quote " + quoteId, now);
        publish(trip, KafkaTopics.Events.TRIP_REQUESTED, new TripEvents.TripRequested(
                trip.getId(), trip.getTripNumber(), trip.getRiderUserId(), trip.getTariff().name(),
                trip.getPickupLat(), trip.getPickupLon(), trip.getPickupAddress(),
                trip.getDropoffLat(), trip.getDropoffLon(), trip.getDropoffAddress(),
                trip.getDistanceM(), trip.getDurationS(), trip.getPriceMinor(), trip.getCommissionBp(),
                trip.getCommissionMinor(), trip.getDriverNetMinor(), trip.getSurgeBp(),
                trip.getCurrency().name(), now));
        log.info("trip {} requested by rider {} ({} {} {}, tariff {})",
                trip.getTripNumber(), riderUserId, trip.getPriceMinor(), trip.getCurrency(),
                trip.getTariff(), trip.getStatus());
        return trip;
    }

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public Trip require(String tripId) {
        return trips.findById(tripId)
                .orElseThrow(() -> DomainException.of(TripErrorCode.TRIP_NOT_FOUND,
                        "trip {} not found", tripId).withDetail("tripId", tripId));
    }

    // ------------------------------------------------------------------ money

    /**
     * Remembers the reservation of the fare.
     *
     * <p>A transaction of its own, and it must be committed before the driver is
     * claimed: the trip is the only record that a hold exists, so a crash between the
     * two has to leave a trip whose hold can be found and reused instead of a second
     * reservation.
     */
    @Transactional
    public Trip attachHold(String tripId, String holdId) {
        Trip trip = require(tripId);
        trip.attachHold(holdId);
        return trips.save(trip);
    }

    // ------------------------------------------------------------------ lifecycle

    /** SEARCHING -> ASSIGNED. The fare is reserved and the driver is claimed. */
    @Transactional
    public Trip markAssigned(String tripId, String driverId, String driverName, String vehiclePlate, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        TripStatus before = trip.getStatus();
        trip.markAssigned(driverId, driverName, vehiclePlate, now);
        trips.save(trip);
        record(trip, before, TripStatus.ASSIGNED, actor, "driver " + driverId, now);
        publish(trip, KafkaTopics.Events.TRIP_DRIVER_ASSIGNED, new TripEvents.TripDriverAssigned(
                trip.getId(), trip.getTripNumber(), trip.getRiderUserId(), driverId, driverName,
                trip.getCurrency().name(), trip.getPriceMinor(), trip.getHoldId(), now));
        log.info("trip {} assigned to driver {} ({} {} reserved under hold {})",
                trip.getTripNumber(), driverId, trip.getPriceMinor(), trip.getCurrency(), trip.getHoldId());
        return trip;
    }

    /**
     * SEARCHING -> NO_DRIVERS_FOUND. Honest answer: nothing is on the way.
     *
     * <p>Takes no "fare released" flag on purpose. The reservation is given back
     * <em>after</em> this call (see {@link #markHoldReleased}), because closing the
     * request is the step that can be refused — a dispatcher may have put a car on this
     * very trip in the meantime — and a refusal must not find the money already gone.
     * The event therefore reports what is true when it is written: a reservation exists
     * and the platform is releasing it.
     */
    @Transactional
    public Trip markNoDriversFound(String tripId, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        TripStatus before = trip.getStatus();
        trip.markNoDriversFound(now);
        trips.save(trip);
        record(trip, before, TripStatus.NO_DRIVERS_FOUND, actor, "no available driver", now);
        publishCancelled(trip, actor, "NO_DRIVERS_FOUND", now);
        log.info("trip {} closed as NO_DRIVERS_FOUND (reservation: {})",
                trip.getTripNumber(), trip.getHoldStatus());
        return trip;
    }

    /** ASSIGNED -> ARRIVED. */
    @Transactional
    public Trip markArrived(String tripId, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        TripStatus before = trip.getStatus();
        trip.markArrived(now);
        trips.save(trip);
        record(trip, before, TripStatus.ARRIVED, actor, null, now);
        publish(trip, KafkaTopics.Events.TRIP_DRIVER_ARRIVED, new TripEvents.TripDriverArrived(
                trip.getId(), trip.getTripNumber(), trip.getDriverId(), now));
        return trip;
    }

    /** ARRIVED -> IN_PROGRESS. The meter starts here. */
    @Transactional
    public Trip markStarted(String tripId, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        TripStatus before = trip.getStatus();
        trip.markStarted(now);
        trips.save(trip);
        record(trip, before, TripStatus.IN_PROGRESS, actor, null, now);
        publish(trip, KafkaTopics.Events.TRIP_STARTED, new TripEvents.TripStarted(
                trip.getId(), trip.getTripNumber(), trip.getDriverId(), now));
        log.info("trip {} started (driver {})", trip.getTripNumber(), trip.getDriverId());
        return trip;
    }

    /**
     * IN_PROGRESS -> COMPLETED, with the capture recorded in the same transaction.
     *
     * <p>The capture itself happened before this call and is idempotent, so a crash
     * between them is a retry that replays the original transaction instead of charging
     * twice.
     */
    @Transactional
    public Trip markCompleted(String tripId, String transactionId, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        TripStatus before = trip.getStatus();
        if (trip.hasActiveHold()) {
            trip.markHoldCaptured(transactionId);
        }
        trip.markCompleted(transactionId, now);
        trips.save(trip);
        record(trip, before, TripStatus.COMPLETED, actor, null, now);
        publish(trip, KafkaTopics.Events.TRIP_COMPLETED, new TripEvents.TripCompleted(
                trip.getId(), trip.getTripNumber(), trip.getRiderUserId(), trip.getDriverId(),
                trip.getDistanceM(), trip.getDurationS(), trip.getPriceMinor(), trip.getCommissionBp(),
                trip.getCommissionMinor(), trip.getDriverNetMinor(), trip.getCurrency().name(),
                trip.getHoldId(), transactionId, now));
        log.info("trip {} completed: {} {} charged, {} {} to the driver, {} {} commission",
                trip.getTripNumber(), trip.getPriceMinor(), trip.getCurrency(),
                trip.getDriverNetMinor(), trip.getCurrency(), trip.getCommissionMinor(), trip.getCurrency());
        return trip;
    }

    /**
     * -> CANCELLED_BY_RIDER / CANCELLED_BY_DRIVER.
     *
     * <p>Like {@link #markNoDriversFound}, the reservation is released by the caller
     * <em>after</em> this commits: the aggregate is the only thing that decides whether
     * cancelling is lawful (it refuses once the rider is in the car), and money must not
     * move before that question is answered.
     */
    @Transactional
    public Trip cancel(String tripId, TripStatus target, String reason, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        TripStatus before = trip.getStatus();
        trip.cancel(target, reason, now);
        trips.save(trip);
        record(trip, before, target, actor, reason, now);
        publishCancelled(trip, actor, reason, now);
        log.info("trip {} cancelled as {} by {} (reason: {}, reservation: {})",
                trip.getTripNumber(), target, actor, reason, trip.getHoldStatus());
        return trip;
    }

    /**
     * Records that the reservation came back to the rider.
     *
     * <p>Its own transaction because the money moves outside the database: the
     * cancellation is committed first (the aggregate decides whether cancelling was
     * lawful at all), and only then is the fare released. A crash between the two leaves
     * a cancelled trip whose reservation is still held; this call is what a retry of the
     * same cancellation uses to close that window.
     *
     * <p>No transition row and no event: the trip's status did not change, and the
     * money side already publishes {@code account.hold.released} on its own topic. The
     * authoritative answer to "was the fare given back" is the trip's
     * {@code holdStatus}, which is what this call sets.
     */
    @Transactional
    public Trip markHoldReleased(String tripId, String reason) {
        Trip trip = require(tripId);
        if (!trip.hasActiveHold()) {
            return trip;
        }
        trip.markHoldReleased();
        trips.save(trip);
        log.info("trip {} released its fare reservation {} ({})",
                trip.getTripNumber(), trip.getHoldId(), reason);
        return trip;
    }

    /** Records the rider's rating. No event: nothing outside this service reacts to it. */
    @Transactional
    public Trip rate(String tripId, int stars, String comment, String actor) {
        Instant now = clock.instant();
        Trip trip = require(tripId);
        trip.rate(stars, comment, now);
        trips.save(trip);
        transitions.save(TripTransition.rating(trip.getId(), actor, now));
        log.info("trip {} rated {} by {}", trip.getTripNumber(), stars, actor);
        return trip;
    }

    // ------------------------------------------------------------------ internals

    private void record(Trip trip,
                        TripStatus from,
                        TripStatus to,
                        String actor,
                        String reason,
                        Instant now) {
        transitions.save(TripTransition.of(trip.getId(), from, to, actor, reason, now));
    }

    private void publishCancelled(Trip trip, String actor, String reason, Instant now) {
        publish(trip, KafkaTopics.Events.TRIP_CANCELLED, new TripEvents.TripCancelled(
                trip.getId(), trip.getTripNumber(), trip.getRiderUserId(), trip.getStatus().name(),
                reason, actor, trip.getHoldStatus() == TripHoldStatus.RELEASED, now));
    }

    /**
     * Queues the event in this transaction.
     *
     * <p>Through the outbox and never through {@code KafkaTemplate} directly: the ride
     * changed and the fact that it changed must be committed together, or a consumer
     * will rebuild a fleet view from a message about a status that never landed.
     */
    private void publish(Trip trip, String eventType, Object payload) {
        outboxWriter.append(KafkaTopics.TRIP_EVENTS, eventType, "Trip", trip.getId(), trip.getVersion(), payload);
    }
}
