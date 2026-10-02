package kz.taxi.qtime.infrastructure;

import jakarta.persistence.LockModeType;
import kz.taxi.qtime.domain.Specialist;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface SpecialistRepository extends JpaRepository<Specialist, String> {

    List<Specialist> findByCompanyIdOrderByRatingBpDesc(String companyId);

    List<Specialist> findByCompanyIdIn(List<String> companyIds);

    /**
     * Reads a specialist <em>and locks the row</em>, for the duration of the booking
     * transaction.
     *
     * <p>This is what makes the interval check trustworthy without an exclusion
     * constraint in the database. Two clients booking the same specialist at 10:00 and
     * 10:30 with a 60-minute service both pass "is this window free?" against a
     * snapshot that does not contain the other one, and a unique index on
     * {@code starts_at} cannot stop them, because the start times differ. Serializing
     * on the specialist row does: the second transaction waits, re-reads the interval
     * list after the first commits, and refuses with {@code SLOT_TAKEN}.
     *
     * <p>Locking the specialist rather than the day's bookings is deliberate: it is one
     * row with a stable identity, so there is no gap in which a lock cannot be taken,
     * and no lock ordering to get wrong.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Specialist s where s.id = :id")
    Optional<Specialist> findByIdForBooking(@Param("id") String id);
}
