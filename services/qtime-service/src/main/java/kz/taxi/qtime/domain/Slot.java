package kz.taxi.qtime.domain;

import java.time.Instant;
import java.util.Objects;

/**
 * One cell of the slot grid: a start time, the end of the service and whether it can
 * be taken.
 *
 * <p>The end is part of the value because a slot has no meaning without the service
 * that determines it: "15:30" is available for a 30-minute haircut and unavailable
 * for a 90-minute manicure when the next appointment is at 17:00. That is why the
 * grid is computed per service and never cached per specialist.
 *
 * <p>{@code reason} is non-null exactly when {@code available} is false — an invariant
 * enforced in the factories rather than left to the mapper, because a cell that is
 * unavailable for no reason is a bug report waiting to happen.
 */
public record Slot(Instant startsAt, Instant endsAt, boolean available, SlotUnavailability reason) {

    public Slot {
        Objects.requireNonNull(startsAt, "startsAt must not be null");
        Objects.requireNonNull(endsAt, "endsAt must not be null");
        if (!endsAt.isAfter(startsAt)) {
            throw new IllegalArgumentException("a slot must end after it starts: " + startsAt + ".." + endsAt);
        }
        if (available && reason != null) {
            throw new IllegalArgumentException("an available slot cannot carry a reason: " + reason);
        }
        if (!available && reason == null) {
            throw new IllegalArgumentException("an unavailable slot must say why");
        }
    }

    public static Slot free(Instant startsAt, Instant endsAt) {
        return new Slot(startsAt, endsAt, true, null);
    }

    public static Slot taken(Instant startsAt, Instant endsAt, SlotUnavailability reason) {
        return new Slot(startsAt, endsAt, false, reason);
    }
}
