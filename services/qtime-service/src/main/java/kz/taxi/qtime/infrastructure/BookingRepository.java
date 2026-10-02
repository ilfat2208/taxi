package kz.taxi.qtime.infrastructure;

import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.BookingStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

/**
 * Bookings.
 *
 * <p>Every "my bookings" combination is a derived query rather than one query with a
 * nullable status parameter. Four short method names beat a query whose behaviour
 * depends on whether a bind parameter arrived as SQL NULL, and the planner gets the
 * same index either way.
 */
public interface BookingRepository extends JpaRepository<Booking, String> {

    /**
     * Bookings of one specialist in a given status that intersect {@code [from, to)} —
     * the slot grid's input, and the check a new booking runs against.
     *
     * <p>The status is a parameter rather than a literal in the query: "which status
     * occupies a window" is a decision of {@link BookingStatus}, not of this string,
     * and the query stays reusable the day a second status starts blocking time.
     */
    @Query("""
            select b from Booking b
             where b.specialistId = :specialistId
               and b.status = :status
               and b.startsAt < :to
               and b.endsAt > :from
             order by b.startsAt asc
            """)
    List<Booking> findActiveBetween(@Param("specialistId") String specialistId,
                                    @Param("status") BookingStatus status,
                                    @Param("from") Instant from,
                                    @Param("to") Instant to);

    Page<Booking> findByClientUserIdOrderByStartsAtDesc(String clientUserId, Pageable pageable);

    Page<Booking> findByClientUserIdAndStatusOrderByStartsAtDesc(String clientUserId, BookingStatus status,
                                                                Pageable pageable);

    Page<Booking> findAllByOrderByStartsAtDesc(Pageable pageable);

    Page<Booking> findByStatusOrderByStartsAtDesc(BookingStatus status, Pageable pageable);
}
