package kz.taxi.qtime.domain;

import java.time.LocalDate;
import java.util.List;

/**
 * The whole answer to "когда свободно": one day of one specialist for one service.
 *
 * <p>Carries the service and the zone next to the cells so the response is
 * self-describing: a client in another country, or a browser that formats times in
 * its own zone, must not have to ask a second question to know what "15:30" meant.
 */
public record SlotGrid(String specialistId,
                       String serviceId,
                       int durationMinutes,
                       String timeZone,
                       LocalDate date,
                       List<Slot> slots) {

    public SlotGrid {
        slots = List.copyOf(slots);
    }

    /** A day off: no cells at all, which is a different answer from "everything is taken". */
    public static SlotGrid closed(String specialistId, String serviceId, int durationMinutes,
                                  String timeZone, LocalDate date) {
        return new SlotGrid(specialistId, serviceId, durationMinutes, timeZone, date, List.of());
    }

    public long availableCount() {
        return slots.stream().filter(Slot::available).count();
    }
}
