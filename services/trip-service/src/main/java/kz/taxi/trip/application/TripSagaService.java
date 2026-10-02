package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.infrastructure.TripProperties;
import kz.taxi.trip.infrastructure.TripRepository;
import kz.taxi.trip.infrastructure.client.DriverFinder;
import kz.taxi.trip.infrastructure.client.DriverRoster;
import kz.taxi.trip.infrastructure.client.RideAccountClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * The ride as a process: find a car, guarantee the money, move the status.
 *
 * <p>This class is where the two facts of a trip meet, and the order in which they are
 * established is the whole design:
 *
 * <pre>
 *   reserve the fare  ->  claim the driver  ->  ASSIGNED
 * </pre>
 *
 * <p><b>Money first.</b> A driver who is claimed for a rider who cannot pay has to be
 * released again, and in the minutes between the two he is not serving anybody else:
 * the platform has taken a working car off the road for nothing. Reserving first means a
 * rider who cannot pay is discovered before a single driver is disturbed, and the price
 * of the mistake is a hold that is released immediately rather than a car parked at a
 * kerb.
 *
 * <p><b>Every remote step is repeatable.</b> The reservation is keyed by the trip,
 * the capture replays the original transaction, the claim is a no-op for the same trip.
 * This class assumes it will run twice — after a timeout, a redeploy, a client that never
 * saw the response — and is written so that running twice changes nothing.
 *
 * <p><b>It owns no transaction.</b> Every state change goes through
 * {@link TripStateService}, one short transaction each, so a refusal can be committed as
 * a fact (the trip is closed with a reason) and still be thrown at the caller as an
 * error. A single transactional method could not do both.
 *
 * <p><strong>Explicitly deferred:</strong> nothing here pays the driver. The rider's fare
 * is captured; {@code driverNetMinor} is computed and stored for the payout step that
 * comes later.
 *
 * <h2>The rule every money path in this class follows</h2>
 *
 * <p>The aggregate decides whether a status move is lawful, and money moves only
 * <em>after</em> that decision has been committed. Every disagreement between the two is
 * then repaired by a repeat of the same call, never by a person:
 *
 * <ul>
 *   <li>cancelled, but the fare is still reserved — the next cancel (or a retry of the
 *       same request) releases it: {@link #healLeftoverReservation};</li>
 *   <li>closed as {@code NO_DRIVERS_FOUND} with the fare still held — the same call
 *       releases it after the status move: {@link #searchDriver};</li>
 *   <li>a car claimed for a ride that was closed in the meantime — the car and the fare
 *       both go back: {@link #healClaimedDriverAfterFailedAssignment}.</li>
 * </ul>
 *
 * <p>The budget of an unrepaired window is bounded on purpose: <b>losing revenue is not
 * allowed</b> (a ride that was performed must always be chargeable), while <b>a fare
 * frozen until the hold expires in the account service is</b> — it is annoying, it is
 * reversible, and it never gives a free ride away.
 */
@Service
@Slf4j
public class TripSagaService {

    private final TripStateService state;
    private final TripRepository trips;
    private final DriverFinder driverFinder;
    private final DriverRoster driverRoster;
    private final RideAccountClient accounts;
    private final TripProperties properties;

    public TripSagaService(TripStateService state,
                           TripRepository trips,
                           DriverFinder driverFinder,
                           DriverRoster driverRoster,
                           RideAccountClient accounts,
                           TripProperties properties) {
        this.state = state;
        this.trips = trips;
        this.driverFinder = driverFinder;
        this.driverRoster = driverRoster;
        this.accounts = accounts;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ ordering

    /**
     * Orders the ride priced by a quote and immediately tries to find a car.
     *
     * <p>The answer is the trip, whatever happened to it: {@code ASSIGNED} when a car
     * was found, {@code NO_DRIVERS_FOUND} when the city had none — which is a normal
     * answer and not an error. Only two things are thrown: a request that cannot be
     * honoured at all (an expired quote, a spent one, a rider without a wallet) and
     * {@link TripErrorCode#INSUFFICIENT_FUNDS}, which leaves a closed trip behind so the
     * refusal is a fact the rider can see.
     *
     * <p>A retry of the same {@code Idempotency-Key} never creates a second trip. It
     * finds the first one and, if the search had not finished, continues it — which is
     * what makes the whole call safe to repeat after a timeout without leaving a rider
     * with a trip stuck in {@code SEARCHING} and money reserved behind it.
     */
    public Trip request(AuthenticatedUser rider, TripDtos.CreateTripRequest request, String idempotencyKey) {
        TripAccess.requireRider(rider);
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST,
                    "header 'Idempotency-Key' is required to order a ride");
        }

        Optional<Trip> seen = trips.findByIdempotencyKey(idempotencyKey);
        Trip trip;
        if (seen.isPresent()) {
            trip = seen.get();
            if (!trip.getRiderUserId().equals(rider.userId())) {
                throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST,
                                "idempotency key {} was already used by another rider", idempotencyKey)
                        .withDetail("idempotencyKey", idempotencyKey);
            }
            log.debug("idempotency key {} already produced trip {}, resuming from {}",
                    idempotencyKey, trip.getTripNumber(), trip.getStatus());
        } else {
            trip = state.create(rider.userId(), request.quoteId(), idempotencyKey, request.comment());
        }

        if (trip.getStatus() != TripStatus.SEARCHING) {
            // The same key already produced this trip: a retry, or the second half of a
            // request whose response was lost. If that trip is over and still holding money
            // (a crash between the commit and the release), the retry is the right moment to
            // repair it — the rider is looking at the screen right now. A live ride is
            // returned untouched: its reservation is doing its job.
            return healLeftoverReservation(trip, "ride closed without a fare");
        }

        try {
            return searchDriver(trip);
        } catch (DomainException failure) {
            if (failure.errorCode() == TripErrorCode.INSUFFICIENT_FUNDS) {
                // The rider's own wallet refused to pay. The ride is closed on his side,
                // with the reason, and the 422 goes back to the app: a rider who cannot
                // pay must not be left with a trip that looks like it is being worked on.
                state.cancel(trip.getId(), TripStatus.CANCELLED_BY_RIDER, "INSUFFICIENT_FUNDS",
                        TripTransition.ACTOR_RIDER);
            }
            throw failure;
        }
    }

    /**
     * Looks for a car and takes the first one that can be claimed.
     *
     * <p>Iterating matters even though dispatch already ranked the candidates: between
     * its answer and this claim another rider's trip may have taken the nearest car, and
     * giving up on the first refusal would tell a rider there are no cars while a second
     * one stands 200 metres further away.
     */
    private Trip searchDriver(Trip trip) {
        List<DriverFinder.Candidate> candidates = driverFinder.nearest(
                trip.getPickupLat(), trip.getPickupLon(), properties.getSearchRadiusM(), properties.getSearchLimit());

        if (candidates.isEmpty()) {
            // Nothing to reserve money for: there is no car to hold it against.
            return state.markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM);
        }

        reserveFare(trip);

        for (DriverFinder.Candidate candidate : candidates) {
            try {
                DriverRoster.DriverView claimed = driverRoster.assignTrip(candidate.driverId(), trip.getId());
                String name = candidate.displayName() == null || candidate.displayName().isBlank()
                        ? claimed.displayName()
                        : candidate.displayName();
                return markAssignedOrHeal(trip.getId(), candidate.driverId(), name, null,
                        TripTransition.ACTOR_SYSTEM);
            } catch (DomainException notAvailable) {
                if (notAvailable.errorCode() == TripErrorCode.DRIVER_NOT_AVAILABLE) {
                    log.debug("candidate {} was taken before we claimed him, trying the next one",
                            candidate.driverId());
                    continue;
                }
                if (notAvailable.errorCode() == TripErrorCode.INVALID_TRIP_TRANSITION
                        || notAvailable.errorCode() == TripErrorCode.TRIP_NOT_ASSIGNABLE) {
                    // Somebody else decided this ride while we were claiming a car for it: a
                    // dispatcher put another driver on it, or the rider called it off. Both
                    // outcomes are better than ours, and both are already recorded — the car we
                    // took has been given back by the healer, and the money is either released
                    // (the ride is closed) or reserved for the ride that exists (it is alive).
                    // Reporting the ride as it is beats an error about a race the rider cannot
                    // see or act on.
                    log.info("trip {} was decided by somebody else while a car was being claimed: {}",
                            trip.getTripNumber(), notAvailable.getMessage());
                    return state.require(trip.getId());
                }
                throw notAvailable;
            }
        }

        // Every candidate was gone by the time we asked. The request is closed first and
        // the fare released after it: closing is the step that can be refused (a
        // dispatcher may have put a car on this very trip), and a refusal must not find
        // the rider's money already gone. A retry repairs the release if this process dies
        // in between, and the hold expires in the account service if nobody retries.
        Trip closed;
        try {
            closed = state.markNoDriversFound(trip.getId(), TripTransition.ACTOR_SYSTEM);
        } catch (DomainException raced) {
            if (raced.errorCode() != TripErrorCode.INVALID_TRIP_TRANSITION) {
                throw raced;
            }
            // Somebody else decided first: a dispatcher put a car on this request, or the
            // rider cancelled it, while we were asking the last candidate. The board is a
            // better outcome than our answer, so nothing is touched — the reservation
            // belongs to the ride that exists now — and the current state is returned.
            log.info("trip {} was decided by somebody else while the search was running: {}",
                    trip.getTripNumber(), raced.getMessage());
            return state.require(trip.getId());
        }
        return releaseFare(closed, "no driver could be claimed");
    }

    // ------------------------------------------------------------------ assignment

    /**
     * Puts a named driver on a live request. Used by the dispatcher's API and by the
     * internal one, so both doors lead to exactly this logic.
     *
     * <p>A repeat with the same driver is a no-op and not a second reservation: dispatch
     * retries, and "assign again" after a timeout must not hold the fare twice. A
     * different driver on a trip that already has one is refused — two cars at one door
     * is a worse failure than an error.
     */
    public Trip assign(String tripId,
                       String driverId,
                       String driverName,
                       String vehiclePlate,
                       String actor) {
        Trip trip = state.require(tripId);

        if (trip.getDriverId() != null) {
            if (trip.getDriverId().equals(driverId)) {
                log.debug("trip {} already belongs to driver {}, nothing to do", trip.getTripNumber(), driverId);
                return trip;
            }
            throw DomainException.of(TripErrorCode.TRIP_NOT_ASSIGNABLE,
                            "trip {} already belongs to driver {}", trip.getTripNumber(), trip.getDriverId())
                    .withDetail("tripId", tripId)
                    .withDetail("driverId", trip.getDriverId());
        }
        if (trip.getStatus() != TripStatus.SEARCHING) {
            throw DomainException.of(TripErrorCode.TRIP_NOT_ASSIGNABLE,
                            "trip {} is {} and cannot take a driver", trip.getTripNumber(), trip.getStatus())
                    .withDetail("tripId", tripId)
                    .withDetail("status", trip.getStatus().name());
        }

        reserveFare(trip);
        DriverRoster.DriverView claimed;
        try {
            claimed = driverRoster.assignTrip(driverId, tripId);
        } catch (DomainException failure) {
            if (failure.errorCode() == TripErrorCode.DRIVER_NOT_AVAILABLE) {
                // A definite answer: this car is not free. The fare goes back now rather
                // than at the hold's expiry, because the rider is entitled to his money
                // and a dispatcher is entitled to try another car immediately.
                releaseFare(state.require(tripId), "driver " + driverId + " could not be claimed");
            }
            // Anything else — driver-service unavailable in particular — leaves the
            // reservation alone on purpose. The claim's outcome is unknown, and releasing
            // the money would leave a car that may already be on its way with nothing to
            // charge; the trip stays SEARCHING with its hold, and a retry resumes it.
            throw failure;
        }
        // The dispatcher's console knows the driver's name; a workload does not. When it
        // is missing, the name driver-service just told us about him is used, so a
        // manually assigned ride still shows a person's name to the rider.
        String resolvedName = driverName == null || driverName.isBlank() ? claimed.displayName() : driverName;
        return markAssignedOrHeal(tripId, driverId, resolvedName, vehiclePlate, actor);
    }

    // ------------------------------------------------------------------ lifecycle

    /** The car is at the pickup point. Repeating the call is harmless. */
    public Trip arrive(String tripId, String actor) {
        Trip trip = state.require(tripId);
        return trip.getStatus() == TripStatus.ARRIVED ? trip : state.markArrived(tripId, actor);
    }

    /** The rider is in the car. */
    public Trip start(String tripId, String actor) {
        Trip trip = state.require(tripId);
        return trip.getStatus() == TripStatus.IN_PROGRESS ? trip : state.markStarted(tripId, actor);
    }

    /**
     * The ride happened: the reserved fare becomes a real charge.
     *
     * <p>The capture happens before the status is written and is idempotent, so a crash
     * between the two is a retry that replays the original transaction instead of
     * charging twice. The driver is released after the ride is committed: a driver left
     * marked busy is visible on the dispatcher's board and can be cleared by hand, while
     * an error returned after a successful charge would tell the rider his completed ride
     * failed.
     */
    public Trip complete(String tripId, String actor) {
        Trip trip = state.require(tripId);
        if (trip.getStatus() == TripStatus.COMPLETED) {
            return trip;
        }
        if (trip.getHoldId() == null) {
            throw DomainException.of(TripErrorCode.TRIP_NOT_ASSIGNED,
                            "trip {} never reserved a fare, so there is nothing to capture", trip.getTripNumber())
                    .withDetail("tripId", tripId);
        }

        RideAccountClient.CaptureView capture = accounts.capture(trip.getHoldId(),
                new RideAccountClient.CaptureRequest(
                        // No target account: the fare leaves the rider's wallet for the
                        // platform's suspense account. Paying the driver his net share is
                        // the deferred payout step, not something a capture does.
                        null,
                        RideAccountClient.REFERENCE_TYPE_TRIP,
                        tripId,
                        // No ledger operation of our own: the account service has no TRIP
                        // operation yet and books the movement as a settlement to suspense,
                        // which is exactly what it is. Adding one would mean changing a
                        // service outside this phase.
                        null,
                        "Fare of trip " + trip.getTripNumber()));

        Trip completed = state.markCompleted(tripId, capture.transactionId(), actor);
        releaseDriverQuietly(completed);
        return completed;
    }

    /**
     * Calls the ride off and gives the money back.
     *
     * <p>Who may do it, and whether a reason is mandatory, is decided by
     * {@link TripAccess}; whether it is possible at all is decided by the aggregate:
     * after {@code IN_PROGRESS} the fare is owed, and no role changes that.
     *
     * <p><b>The status changes first, the money second</b>, and the order is the whole
     * point. Releasing the fare before asking the aggregate would mean that a rider who
     * presses "cancel" during his own ride has his reservation returned and then gets a
     * 409 — the ride continues, the driver finishes it, and the capture finds no hold:
     * the platform silently gives away a completed ride. Checking the status before
     * releasing does not help either, because the driver can start the ride in the window
     * between the check and the move.
     *
     * <p>With this order the worst case is bounded: a cancellation that committed but
     * whose release did not happen leaves the fare reserved until the next attempt (this
     * method releases a leftover reservation) or until the hold expires in the account
     * service. Money is never given back for a ride that is still owed.
     */
    public Trip cancel(AuthenticatedUser caller, String tripId, String reason, String cancelledBy) {
        Trip trip = state.require(tripId);
        TripAccess.Canceller canceller = TripAccess.requireCanceller(caller, trip.getRiderUserId());
        String releaseReason = reason == null || reason.isBlank() ? "trip cancelled" : reason;

        if (trip.getStatus().isCancelled()) {
            // Already cancelled: a repeated request is a client retry, not a second
            // cancellation. It must not fail on a reservation that a previous attempt
            // committed without releasing — that window is exactly what this heals.
            return healLeftoverReservation(trip, releaseReason);
        }
        TripAccess.requireCancellationReason(canceller, reason);

        TripStatus target = canceller == TripAccess.Canceller.RIDER
                ? TripStatus.CANCELLED_BY_RIDER
                : operatorCancellationStatus(cancelledBy);

        // The aggregate answers "is this cancellation lawful at all?" — and it is the
        // only thing that may answer it (409 for a ride in progress, and nothing else is
        // touched when it refuses).
        Trip cancelled = state.cancel(tripId, target, reason,
                TripAccess.cancellationActor(caller, canceller));

        cancelled = releaseFare(cancelled, releaseReason);
        releaseDriverQuietly(cancelled);
        return cancelled;
    }

    /**
     * Closes the window between "the cancellation is committed" and "the fare is back".
     *
     * <p>A trip that is already cancelled but still holds a reservation is a fact this
     * service can repair rather than report: the release is idempotent, so re-issuing it
     * is safe whether the first attempt never ran, ran halfway, or ran fully and lost its
     * response.
     */
    private Trip healLeftoverReservation(Trip trip, String reason) {
        // Only a ride that ended *without happening* can have a leftover reservation, and
        // the guard lives here rather than being trusted to every caller. A live ride owns
        // its reservation (ASSIGNED, ARRIVED, IN_PROGRESS) — releasing it would be the bug
        // this healing exists to prevent — and a COMPLETED ride is owed its fare: a hold
        // still ACTIVE on a completed ride needs a capture (a support incident), never a
        // silent refund. The driver's presence is irrelevant: cancelling after a car was
        // assigned is the most ordinary cancellation there is.
        boolean closedWithoutRide = trip.getStatus().isCancelled()
                || trip.getStatus() == TripStatus.NO_DRIVERS_FOUND;
        if (!closedWithoutRide || !trip.hasActiveHold()) {
            return trip;
        }
        log.warn("trip {} is {} but still holds reservation {}; releasing it",
                trip.getTripNumber(), trip.getStatus(), trip.getHoldId());
        return releaseFare(trip, reason);
    }

    /** Records the rider's verdict on the ride. Only the rider has one. */
    public Trip rate(AuthenticatedUser caller, String tripId, int stars, String comment) {
        Trip trip = state.require(tripId);
        if (!caller.userId().equals(trip.getRiderUserId())) {
            throw DomainException.of(TripErrorCode.FORBIDDEN_TRIP_ACCESS,
                            "user {} may not rate trip {}", caller.userId(), trip.getTripNumber())
                    .withDetail("tripId", tripId);
        }
        return state.rate(tripId, stars, comment, TripTransition.ACTOR_RIDER);
    }

    // ------------------------------------------------------------------ money

    /**
     * Reserves the fare on the rider's wallet, once.
     *
     * <p>Three defences, in this order, because this is the step that can take a rider's
     * money twice:
     * <ol>
     *   <li>the trip already knows a hold — nothing to do;</li>
     *   <li>the trip does not, but the account service has an active hold for this very
     *       trip — that is a crash between the reservation and the write, so the hold is
     *       adopted rather than repeated;</li>
     *   <li>otherwise a new reservation, keyed by the trip id, so even a concurrent
     *       second attempt gets the same hold back.</li>
     * </ol>
     */
    private void reserveFare(Trip trip) {
        if (trip.hasActiveHold()) {
            return;
        }
        String accountId = trip.getRiderAccountId();
        if (accountId == null || accountId.isBlank()) {
            throw DomainException.of(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND,
                            "trip {} has no wallet to charge", trip.getTripNumber())
                    .withDetail("tripId", trip.getId());
        }

        Optional<RideAccountClient.HoldView> existing = accounts.findActiveHold(
                RideAccountClient.REFERENCE_TYPE_TRIP, trip.getId(), accountId);
        if (existing.isPresent()) {
            log.info("trip {} already holds {} under hold {}, adopting it",
                    trip.getTripNumber(), trip.getPriceMinor(), existing.get().holdId());
            state.attachHold(trip.getId(), existing.get().holdId());
            return;
        }

        RideAccountClient.HoldView hold = accounts.placeHold(new RideAccountClient.HoldRequest(
                accountId,
                trip.getPriceMinor(),
                trip.getCurrency(),
                RideAccountClient.REFERENCE_TYPE_TRIP,
                trip.getId(),
                holdKey(trip.getId()),
                "Fare of trip " + trip.getTripNumber()));
        state.attachHold(trip.getId(), hold.holdId());
    }

    /**
     * Gives the reserved fare back, if there is anything to give back.
     *
     * <p>One helper for every path that returns money, because they must all do the same
     * two things in the same order: release it at the account service (idempotent) and
     * then record on the trip that it is back. A path that released without recording
     * would leave a live trip whose reservation looks active, and the next retry would
     * release it again — harmless, but the trip's own answer to "is my money held" would
     * be wrong.
     *
     * @return the trip as it is now
     */
    private Trip releaseFare(Trip trip, String reason) {
        if (!trip.hasActiveHold()) {
            return trip;
        }
        accounts.release(trip.getHoldId(), reason);
        return state.markHoldReleased(trip.getId(), reason);
    }

    /**
     * Writes the assignment, and cleans up if the ride turned out to be closed.
     *
     * <p>The window this closes: the car is claimed before the assignment is written, so
     * the rider's cancellation (or another search's own close) can land in between. The
     * assignment then fails — and both facts of that window, a fare reserved for this trip
     * and a car claimed for it, belong to a ride nobody will perform.
     */
    private Trip markAssignedOrHeal(String tripId,
                                    String driverId,
                                    String driverName,
                                    String vehiclePlate,
                                    String actor) {
        try {
            return state.markAssigned(tripId, driverId, driverName, vehiclePlate, actor);
        } catch (DomainException failure) {
            healClaimedDriverAfterFailedAssignment(tripId, driverId);
            throw failure;
        }
    }

    /**
     * Gives back a car that the ride it was claimed for no longer wants.
     *
     * <p>Reachable when the ride was closed (cancelled, or closed by another search) or taken
     * by another driver in the window between claiming the car and writing the assignment. In
     * both cases the car is not on the ride that exists now, and leaving it claimed means a
     * driver who is busy for nobody — the leak that turns into a support ticket.
     *
     * <p>Money is handled separately from the car, and deliberately: the reservation goes back
     * only when the ride ended <em>without happening</em>. A ride that is alive — assigned to
     * the dispatcher's driver, in progress, completed — owns its fare, and releasing it here
     * would be the very bug this method exists to prevent.
     */
    private void healClaimedDriverAfterFailedAssignment(String tripId, String driverId) {
        Trip current = state.require(tripId);
        if (driverId.equals(current.getDriverId())) {
            // The assignment did land on this very driver after all (two identical calls in
            // flight): the car is on the ride and there is nothing to give back.
            return;
        }
        log.warn("driver {} was claimed for trip {} which is now {} (driver {}); giving the car back",
                driverId, current.getTripNumber(), current.getStatus(),
                current.getDriverId() == null ? "none" : current.getDriverId());

        boolean closedWithoutRide = current.getStatus().isCancelled()
                || current.getStatus() == TripStatus.NO_DRIVERS_FOUND;
        if (closedWithoutRide) {
            releaseFare(current, "ride was closed while a driver was being claimed");
        }
        try {
            driverRoster.finishTrip(driverId);
        } catch (RuntimeException failure) {
            log.error("driver {} stayed busy after trip {} could not take him: {}",
                    driverId, current.getTripNumber(), failure.toString());
        }
    }

    /**
     * Releases the driver, and deliberately does not fail the request if it cannot.
     *
     * <p>It runs after the ride has been committed and, on completion, after the money
     * has moved. Failing here would return an error for a ride that is finished and
     * charged — the rider would retry a receipt he already has, and support would see a
     * failure for a trip that succeeded. A driver left marked busy is a visible,
     * recoverable state on the dispatcher's board; a reconciliation job that sweeps
     * drivers whose trip is over belongs with the matching work of the next phase.
     */
    private void releaseDriverQuietly(Trip trip) {
        if (trip.getDriverId() == null) {
            return;
        }
        try {
            driverRoster.finishTrip(trip.getDriverId());
        } catch (RuntimeException failure) {
            log.error("trip {} is {} but driver {} could not be released: {}",
                    trip.getTripNumber(), trip.getStatus(), trip.getDriverId(), failure.toString());
        }
    }

    /** The reservation key of a trip: derived, so a retry cannot produce a different one. */
    static String holdKey(String tripId) {
        return "TRIP-HOLD-" + tripId;
    }

    /**
     * Whose side an operator's cancellation came from.
     *
     * <p>Only meaningful for a dispatcher or an operator: the rider's own cancellation is
     * always his. A dispatcher closing a request nobody is serving says {@code RIDER}
     * (the default); one unblocking a ride whose driver never showed up says
     * {@code DRIVER}, which is the difference between "the rider changed his mind" and
     * "the driver let him down" in every later report.
     */
    private static TripStatus operatorCancellationStatus(String cancelledBy) {
        if (cancelledBy == null || cancelledBy.isBlank()) {
            return TripStatus.CANCELLED_BY_RIDER;
        }
        return switch (cancelledBy.trim().toUpperCase()) {
            case "RIDER" -> TripStatus.CANCELLED_BY_RIDER;
            case "DRIVER" -> TripStatus.CANCELLED_BY_DRIVER;
            default -> throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST,
                            "cancelledBy must be RIDER or DRIVER but was '{}'", cancelledBy)
                    .withDetail("cancelledBy", cancelledBy);
        };
    }
}
