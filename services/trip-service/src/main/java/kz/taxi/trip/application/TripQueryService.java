package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripReceipt;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.infrastructure.TripProperties;
import kz.taxi.trip.infrastructure.TripRepository;
import kz.taxi.trip.infrastructure.TripTransitionRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Reads: one ride, one check, and the board.
 *
 * <p>Reads take no locks and change nothing — everything here is
 * {@code readOnly = true} — but they are the file that decides who sees what, so they
 * are worth reading as the answer to three different questions:
 *
 * <ul>
 *   <li><b>A rider's history</b> is his own rides and nobody else's, whatever filter he
 *       sends: the ownership clause is not a filter that a parameter can widen.</li>
 *   <li><b>A dispatcher's board</b> is every live request, because a car can only be put
 *       on a request the dispatcher can see. It defaults to the live statuses: a board
 *       that showed yesterday's finished rides would be a report, not a board.</li>
 *   <li><b>Support and operators</b> see everything, any status — that is what support
 *       is for.</li>
 * </ul>
 *
 * <p>Each of those is a different repository method rather than one query with a
 * {@code WHERE} assembled from the caller's roles: a single query that is "widened" by a
 * parameter is one bug away from showing a rider somebody else's address.
 */
@Service
@Slf4j
public class TripQueryService {

    private final TripRepository trips;
    private final TripTransitionRepository transitions;
    private final TripProperties properties;

    public TripQueryService(TripRepository trips,
                            TripTransitionRepository transitions,
                            TripProperties properties) {
        this.trips = trips;
        this.transitions = transitions;
        this.properties = properties;
    }

    /** One ride with its history, for its rider, for support, for an operator. */
    @Transactional(readOnly = true)
    public TripDetails details(AuthenticatedUser caller, String tripId) {
        TripDetails details = internalDetails(tripId);
        TripAccess.requireReader(caller, details.trip().getRiderUserId());
        return details;
    }

    /** The same, without a caller: the internal API is authenticated as a workload. */
    @Transactional(readOnly = true)
    public TripDetails internalDetails(String tripId) {
        Trip trip = require(tripId);
        List<TripTransition> timeline = transitions.findByTripIdOrderByOccurredAtAscIdAsc(tripId);
        return new TripDetails(trip, timeline);
    }

    /**
     * The check of a performed ride.
     *
     * <p>Refused with 409 while the ride is still moving: the receipt is the record of
     * something that happened, and issuing one early would give a promise the authority
     * of a document. The same object is embedded in {@code GET /trips/{id}} for a
     * completed ride — one implementation, two ways of asking.
     */
    @Transactional(readOnly = true)
    public TripReceipt receipt(AuthenticatedUser caller, String tripId) {
        Trip trip = require(tripId);
        TripAccess.requireReader(caller, trip.getRiderUserId());
        return TripReceipt.of(trip);
    }

    /** A page of trips, newest first, scoped by the caller's role. */
    @Transactional(readOnly = true)
    public PageResponse<Trip> list(AuthenticatedUser caller, TripStatus status, int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), clamp(size));
        Page<Trip> result;

        if (TripAccess.isOperator(caller)) {
            result = status == null
                    ? trips.findAllByOrderByRequestedAtDesc(pageable)
                    : trips.findByStatusOrderByRequestedAtDesc(status, pageable);
        } else if (TripAccess.isDispatcher(caller)) {
            // The dispatcher's board: live requests by default, because that is what a
            // dispatcher can act on. Asking for a status narrows it to that status only —
            // including the finished ones, which is how a dispatcher reviews a shift.
            result = status == null
                    ? trips.findByStatusInOrderByRequestedAtDesc(TripStatus.live(), pageable)
                    : trips.findByStatusOrderByRequestedAtDesc(status, pageable);
        } else {
            TripAccess.requireRider(caller);
            String riderUserId = caller.userId();
            result = status == null
                    ? trips.findByRiderUserIdOrderByRequestedAtDesc(riderUserId, pageable)
                    : trips.findByRiderUserIdAndStatusOrderByRequestedAtDesc(riderUserId, status, pageable);
        }

        return PageResponse.of(result.getContent(), result.getNumber(), result.getSize(),
                result.getTotalElements());
    }

    @Transactional(readOnly = true)
    public Trip require(String tripId) {
        return trips.findById(tripId)
                .orElseThrow(() -> DomainException.of(TripErrorCode.TRIP_NOT_FOUND,
                        "trip {} not found", tripId).withDetail("tripId", tripId));
    }

    private int clamp(int size) {
        if (size <= 0) {
            return properties.getPageSizeDefault();
        }
        return Math.min(size, properties.getPageSizeMax());
    }
}
