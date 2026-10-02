package kz.taxi.qtime.infrastructure;

import kz.taxi.qtime.domain.ScheduleException;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.Optional;

/**
 * Dated exceptions to the weekly rules.
 *
 * <p>Looked up one date at a time, which is exactly how the slot grid uses them: the
 * question is "работает ли мастер в этот конкретный день", and one row per date — the
 * seeder writes vacations day by day, not as a range — makes that an index lookup instead
 * of a range intersection.
 */
public interface ScheduleExceptionRepository extends JpaRepository<ScheduleException, String> {

    Optional<ScheduleException> findBySpecialistIdAndExceptionDate(String specialistId, LocalDate date);
}
