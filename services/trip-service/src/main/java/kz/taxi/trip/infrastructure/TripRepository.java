package kz.taxi.trip.infrastructure;

import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.Optional;

/**
 * Trips, by the four questions the service asks.
 *
 * <p>{@code findByIdempotencyKey} is the second line of defence behind the platform's
 * idempotency store: the store is Redis, Redis can be flushed or replaced, and the
 * unique index on the column (see {@code V1__init_trip.sql}) is what actually makes
 * "the same key never creates a second trip" true.
 *
 * <p>Each finder mirrors exactly one visibility rule of the API, so the query that
 * serves a rider's history cannot accidentally be the query that serves the
 * dispatcher's board: they are different methods returning different sets.
 */
public interface TripRepository extends JpaRepository<Trip, String> {

    Optional<Trip> findByIdempotencyKey(String idempotencyKey);

    // ------------------------------------------------------------------ rider's own
    Page<Trip> findByRiderUserIdOrderByRequestedAtDesc(String riderUserId, Pageable pageable);

    Page<Trip> findByRiderUserIdAndStatusOrderByRequestedAtDesc(String riderUserId,
                                                                TripStatus status,
                                                                Pageable pageable);

    // ------------------------------------------------------------------ dispatcher's board
    Page<Trip> findByStatusOrderByRequestedAtDesc(TripStatus status, Pageable pageable);

    Page<Trip> findByStatusInOrderByRequestedAtDesc(Collection<TripStatus> statuses,
                                                    Pageable pageable);

    // ------------------------------------------------------------------ operators
    Page<Trip> findAllByOrderByRequestedAtDesc(Pageable pageable);
}
