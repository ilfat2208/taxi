package kz.taxi.qtime.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;

/**
 * One recurring rule of a specialist's week: "по понедельникам 09:00-20:00, обед
 * 13:00-14:00".
 *
 * <p>The intervals are {@code [start, end)} and {@code [breakStart, breakEnd)}:
 * a service that ends exactly when the break starts is fine, and a service that
 * starts exactly when the break ends is fine too. Half-open intervals are what make
 * "back-to-back" appointments expressible without a one-minute gap nobody wants.
 *
 * <p>There is no "day off" row: a day without a rule is a day the specialist does
 * not work. {@link #covers} and {@link #crossesBreak} are the only two questions
 * the slot grid ever asks of a rule, so they live here rather than in the service
 * that happens to call them.
 */
@Entity
@Table(name = "working_hours")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class WorkingHours {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "specialist_id", length = 26, nullable = false, updatable = false)
    private String specialistId;

    @Column(name = "day_of_week", nullable = false, updatable = false)
    private DayOfWeek dayOfWeek;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    @Column(name = "break_start")
    private LocalTime breakStart;

    @Column(name = "break_end")
    private LocalTime breakEnd;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Creates a weekly rule. The break is optional and must lie inside the shift. */
    public static WorkingHours rule(String specialistId, DayOfWeek dayOfWeek,
                                    LocalTime startTime, LocalTime endTime,
                                    LocalTime breakStart, LocalTime breakEnd, Instant now) {
        if (specialistId == null || specialistId.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS, "specialistId is required");
        }
        if (dayOfWeek == null || startTime == null || endTime == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS,
                    "day of week and both shift boundaries are required");
        }
        if (!endTime.isAfter(startTime)) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS,
                            "shift {} must end after it starts ({})", dayOfWeek, startTime)
                    .withDetail("dayOfWeek", dayOfWeek.name());
        }
        if ((breakStart == null) != (breakEnd == null)) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS,
                    "a break needs both boundaries; got {} and {}", breakStart, breakEnd);
        }
        if (breakStart != null && (breakStart.isBefore(startTime)
                || breakEnd.isAfter(endTime)
                || !breakEnd.isAfter(breakStart))) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS,
                            "break {}-{} is not inside the shift {}-{}",
                            breakStart, breakEnd, startTime, endTime)
                    .withDetail("dayOfWeek", dayOfWeek.name());
        }

        WorkingHours hours = new WorkingHours();
        hours.id = Ulid.nextId();
        hours.specialistId = specialistId;
        hours.dayOfWeek = dayOfWeek;
        hours.startTime = startTime;
        hours.endTime = endTime;
        hours.breakStart = breakStart;
        hours.breakEnd = breakEnd;
        hours.createdAt = now;
        hours.updatedAt = now;
        return hours;
    }

    // ------------------------------------------------------------------ queries

    /**
     * True when {@code [from, to)} lies inside the shift.
     *
     * <p>A service that merely *overlaps* the shift is not covered: an appointment
     * cannot start before the master arrives or run past closing time, and returning
     * "partially inside" would make the caller invent the rule.
     */
    public boolean covers(LocalTime from, LocalTime to) {
        return !from.isBefore(startTime) && !to.isAfter(endTime);
    }

    /** True when {@code [from, to)} intersects the break. Touching the break is not intersecting it. */
    public boolean crossesBreak(LocalTime from, LocalTime to) {
        return breakStart != null && overlaps(breakStart, breakEnd, from, to);
    }

    /** Half-open interval intersection: {@code [aStart, aEnd)} vs {@code [bStart, bEnd)}. */
    static boolean overlaps(LocalTime aStart, LocalTime aEnd, LocalTime bStart, LocalTime bEnd) {
        return bStart.isBefore(aEnd) && aStart.isBefore(bEnd);
    }
}
