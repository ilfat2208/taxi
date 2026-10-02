package kz.taxi.qtime.infrastructure;

import kz.taxi.qtime.domain.WorkingHours;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.DayOfWeek;
import java.util.List;

/**
 * The weekly rules.
 *
 * <p>One finder, because the slot grid asks exactly one question — "какое правило
 * действует в этот день недели?" — and a missing row is the answer "выходной". A
 * "whole week of this specialist" finder belongs to the ORTA Business schedule screen,
 * and is written when that screen exists.
 */
public interface WorkingHoursRepository extends JpaRepository<WorkingHours, String> {

    /** The rule of one weekday. Empty means the specialist does not work that day. */
    List<WorkingHours> findBySpecialistIdAndDayOfWeek(String specialistId, DayOfWeek dayOfWeek);
}
