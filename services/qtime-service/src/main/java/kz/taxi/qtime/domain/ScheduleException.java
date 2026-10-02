package kz.taxi.qtime.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;

/**
 * A dated exception to a recurring week: vacation, day off, extra shift.
 *
 * <p>Modeled now even though no screen sets it yet, because the difference between
 * "по понедельникам 09:00-20:00" and "этот понедельник — выходной" is the difference
 * between a calendar and a lie. The slot query reads this table before it reads the
 * weekly rule, so the day a master is on vacation publishes no windows at all
 * instead of eleven bookable ones.
 */
@Entity
@Table(name = "schedule_exception")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ScheduleException {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "specialist_id", length = 26, nullable = false, updatable = false)
    private String specialistId;

    /** One row per date: "с 1 по 14 июня" is fourteen rows, not a range to intersect. */
    @Column(name = "exception_date", nullable = false, updatable = false)
    private LocalDate exceptionDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", length = 16, nullable = false)
    private ScheduleExceptionKind kind;

    @Column(name = "start_time")
    private LocalTime startTime;

    @Column(name = "end_time")
    private LocalTime endTime;

    @Column(name = "note", length = 255)
    private String note;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Closes a day: vacation or day off. */
    public static ScheduleException close(String specialistId, LocalDate date,
                                          ScheduleExceptionKind kind, String note, Instant now) {
        if (kind == null || !kind.closesDay()) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS,
                    "use {} for extra work", ScheduleExceptionKind.EXTRA_SHIFT);
        }
        ScheduleException exception = base(specialistId, date, kind, note, now);
        exception.startTime = null;
        exception.endTime = null;
        return exception;
    }

    /** Adds a shift on a date the weekly rule does not cover. */
    public static ScheduleException extraShift(String specialistId, LocalDate date,
                                               LocalTime startTime, LocalTime endTime,
                                               String note, Instant now) {
        if (startTime == null || endTime == null || !endTime.isAfter(startTime)) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS,
                    "an extra shift needs a window that ends after it starts, got {}-{}", startTime, endTime);
        }
        ScheduleException exception = base(specialistId, date, ScheduleExceptionKind.EXTRA_SHIFT, note, now);
        exception.startTime = startTime;
        exception.endTime = endTime;
        return exception;
    }

    private static ScheduleException base(String specialistId, LocalDate date,
                                          ScheduleExceptionKind kind, String note, Instant now) {
        if (specialistId == null || specialistId.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS, "specialistId is required");
        }
        if (date == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_WORKING_HOURS, "exceptionDate is required");
        }
        ScheduleException exception = new ScheduleException();
        exception.id = Ulid.nextId();
        exception.specialistId = specialistId;
        exception.exceptionDate = date;
        exception.kind = kind;
        exception.note = note;
        exception.createdAt = now;
        exception.updatedAt = now;
        return exception;
    }

    // ------------------------------------------------------------------ queries

    public boolean closesDay() {
        return kind.closesDay();
    }

    @Override
    public String toString() {
        return "ScheduleException[%s %s %s]".formatted(exceptionDate, kind, specialistId);
    }
}
