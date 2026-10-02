package kz.taxi.trip.infrastructure;

import kz.taxi.trip.domain.TripTransition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * The trip timeline.
 *
 * <p>Ordered by {@code occurredAt} with the id as a tie-break: several transitions can
 * land in the same millisecond (a cancellation right after an assignment), and a
 * timeline whose order depends on the database's mood is not a timeline. The id is a
 * ULID, which is monotonic — so "id ascending" is exactly "written in this order".
 */
public interface TripTransitionRepository extends JpaRepository<TripTransition, String> {

    List<TripTransition> findByTripIdOrderByOccurredAtAscIdAsc(String tripId);
}
