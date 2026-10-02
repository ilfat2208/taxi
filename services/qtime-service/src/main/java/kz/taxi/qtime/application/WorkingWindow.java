package kz.taxi.qtime.application;

import kz.taxi.qtime.domain.ScheduleException;
import kz.taxi.qtime.domain.WorkingHours;

import java.time.LocalTime;

/**
 * One stretch of working time on one date, in the only units the slot arithmetic needs:
 * minutes from midnight.
 *
 * <p>A single shape for two sources — the weekly {@code working_hours} rule and the
 * {@code schedule_exception} that replaces it for a date (an extra Saturday shift) —
 * so neither the grid nor the booking check has to ask where a window came from.
 * {@code breakStart}/{@code breakEnd} are null when there is no break, which is also
 * the honest answer for a hand-added shift: it removes windows somebody put in the
 * calendar deliberately.
 *
 * <p>Intervals are half-open: a service ending exactly at 13:00 does not cross a
 * 13:00-14:00 lunch, and a service starting exactly at 14:00 is fine. Anything else
 * would need a one-minute dead zone between appointments that no salon wants and no
 * client understands.
 *
 * <p>{@link #insideShift} and {@link #crossesBreak} are kept apart on purpose, even
 * though {@link #covers} is just their conjunction: a grid cell that runs into lunch
 * is a different message to the client ("перерыв") from a cell that runs past closing
 * time ("не хватает времени"), and collapsing them would leave the screen guessing.
 */
record WorkingWindow(LocalTime start, LocalTime end, LocalTime breakStart, LocalTime breakEnd) {

    static WorkingWindow of(WorkingHours rule) {
        return new WorkingWindow(rule.getStartTime(), rule.getEndTime(),
                rule.getBreakStart(), rule.getBreakEnd());
    }

    /** A shift added by hand: the hours somebody wrote down, without a break. */
    static WorkingWindow extraShift(ScheduleException exception) {
        return new WorkingWindow(exception.getStartTime(), exception.getEndTime(), null, null);
    }

    int startMinutes() {
        return minutes(start);
    }

    int endMinutes() {
        return minutes(end);
    }

    boolean hasBreak() {
        return breakStart != null;
    }

    int breakStartMinutes() {
        return minutes(breakStart);
    }

    int breakEndMinutes() {
        return minutes(breakEnd);
    }

    /** True when {@code [from, to)} lies between the shift boundaries, break ignored. */
    boolean insideShift(int from, int to) {
        return from >= startMinutes() && to <= endMinutes();
    }

    /** True when {@code [from, to)} fits the shift and misses the break — the bookable case. */
    boolean covers(int from, int to) {
        return insideShift(from, to) && !crossesBreak(from, to);
    }

    /** True when {@code [from, to)} intersects the break. Touching it is not intersecting it. */
    boolean crossesBreak(int from, int to) {
        return hasBreak() && breakStartMinutes() < to && from < breakEndMinutes();
    }

    /** True when the interval is inside the shift but runs into the break. */
    boolean hitsBreak(int from, int to) {
        return insideShift(from, to) && crossesBreak(from, to);
    }

    /** True when {@code [from, to)} overlaps this window at all — "you asked for a time we do not work". */
    boolean intersects(int from, int to) {
        return from < endMinutes() && startMinutes() < to;
    }

    static int minutes(LocalTime time) {
        return time.getHour() * 60 + time.getMinute();
    }
}
