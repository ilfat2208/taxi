package kz.taxi.qtime.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.qtime.api.dto.QtimeDtos;
import kz.taxi.qtime.application.BookingApplicationService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service API, driven by the company side of the platform.
 *
 * <p>Everything under {@code /api/v1/qtime/internal/} is protected by the platform's
 * {@code InternalApiTokenFilter} on the {@code X-Internal-Token} header: no user JWT is
 * involved, because the caller acts as a workload — the ORTA Business calendar closes a
 * visit for a company it belongs to, which is not the caller's own booking, and that
 * authority cannot be expressed with user roles. The public gateway never routes
 * {@code /internal/} paths.
 *
 * <p>One endpoint so far. The rest of the CRM surface (день компании, перенос записи,
 * неявка) arrives with the ORTA Business screens, which is why {@code markNoShow} already
 * exists in the aggregate and nothing calls it yet.
 */
@RestController
@RequestMapping("/api/v1/qtime/internal")
@Tag(name = "QTime internal", description = "Service-to-service booking API (X-Internal-Token)")
public class InternalQtimeController {

    private final BookingApplicationService bookings;
    private final QtimeMapper mapper;

    public InternalQtimeController(BookingApplicationService bookings, QtimeMapper mapper) {
        this.bookings = bookings;
        this.mapper = mapper;
    }

    @PostMapping("/bookings/{bookingId}/complete")
    @Operation(summary = "Close a visit: the booking becomes COMPLETED",
            description = "Idempotent: completing an already completed booking returns it unchanged instead of a "
                    + "conflict, so a retried call from a calendar integration is harmless. 409 "
                    + "BOOKING_NOT_COMPLETABLE for a cancelled booking. Publishes booking.completed, which is the "
                    + "moment a review, a settlement or a next-visit reminder may follow.")
    public QtimeDtos.BookingResponse complete(@PathVariable String bookingId) {
        return mapper.toBooking(bookings.complete(bookingId));
    }
}
