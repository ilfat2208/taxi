package kz.taxi.qtime.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.qtime.api.dto.QtimeDtos;
import kz.taxi.qtime.application.SlotService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * Free windows — the one endpoint every service vertical shares.
 *
 * <p>This is what the mockup's grid is drawn from, and the shape is deliberate: the
 * answer contains <em>every</em> cell of the working day, free and taken alike. The
 * screen shows the taken ones crossed out, and a client who sees 12:30 greyed out
 * understands "мастер занят, вот 15:30" — while a grid that silently skipped the time
 * would look broken. Each cell says why it cannot be taken.
 *
 * <p>Anonymous, like the company catalogue it belongs to: the free windows are the
 * advertisement, and they are what a person chooses a salon by.
 */
@RestController
@RequestMapping("/api/v1/qtime/specialists")
@Tag(name = "QTime slots", description = "Free and taken windows of a specialist for one service")
public class SlotController {

    private final SlotService slots;
    private final QtimeMapper mapper;

    public SlotController(SlotService slots, QtimeMapper mapper) {
        this.slots = slots;
        this.mapper = mapper;
    }

    @GetMapping("/{specialistId}/slots")
    @Operation(summary = "The slot grid of one day",
            description = "The service determines the answer: a 90-minute manicure is not free at 12:30 for the "
                    + "same reason a 30-minute haircut is. Cells in the past, or closer than the minimum lead "
                    + "time, are not returned at all — the grid starts at the first time that can be booked. "
                    + "A day off is an empty list, not an error. 422 BOOKING_IN_PAST for a date before today, "
                    + "422 OUTSIDE_BOOKING_HORIZON beyond the published horizon, 400 for a service this "
                    + "specialist does not provide.")
    public QtimeDtos.SlotsResponse slots(
            @PathVariable String specialistId,
            @Parameter(description = "Service the window is requested for") @RequestParam String serviceId,
            @Parameter(description = "Date in the company's time zone")
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return mapper.toSlots(slots.slots(specialistId, serviceId, date));
    }
}
