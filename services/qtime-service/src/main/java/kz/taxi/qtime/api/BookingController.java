package kz.taxi.qtime.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.web.idempotency.IdempotencyContext;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.qtime.api.dto.QtimeDtos;
import kz.taxi.qtime.application.BookingApplicationService;
import kz.taxi.qtime.application.BookingWithNames;
import kz.taxi.qtime.application.CreateBookingCommand;
import kz.taxi.qtime.domain.BookingStatus;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * Taking and releasing windows.
 *
 * <p>Idempotency is owned by the controller rather than by the use case, exactly as in
 * {@code payment-service}: {@link IdempotencyGuard} has to hash the request body, and it
 * can only do that where the body still exists as the client sent it. A retried booking
 * therefore replays the stored response — the same booking, the same code — instead of
 * racing against its own first attempt.
 *
 * <p>Who may do what is decided by the application service ({@code QtimeAccess}), not
 * here: "only a client books, a merchant cancels on behalf of the company, support and
 * admin read everything" is a business rule, and this class stays thin.
 */
@RestController
@RequestMapping("/api/v1/qtime/bookings")
@Tag(name = "QTime bookings", description = "Appointments: take a window, list yours, cancel")
public class BookingController {

    private static final int MAX_PAGE_SIZE = 100;

    private final BookingApplicationService bookings;
    private final QtimeMapper mapper;
    private final CurrentUser currentUser;
    private final IdempotencyGuard idempotencyGuard;

    public BookingController(BookingApplicationService bookings,
                             QtimeMapper mapper,
                             CurrentUser currentUser,
                             IdempotencyGuard idempotencyGuard) {
        this.bookings = bookings;
        this.mapper = mapper;
        this.currentUser = currentUser;
        this.idempotencyGuard = idempotencyGuard;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Book a window (role CUSTOMER)",
            description = "Requires the Idempotency-Key header: a retry with the same key and body returns the "
                    + "same booking instead of taking a second window. Refusals: 400 "
                    + "SERVICE_NOT_OFFERED_BY_SPECIALIST when the offer is not this specialist's, 422 "
                    + "COMPANY_NOT_AVAILABLE / OUTSIDE_WORKING_HOURS / BOOKING_IN_PAST / BOOKING_TOO_SOON / "
                    + "OUTSIDE_BOOKING_HORIZON, 409 SLOT_TAKEN when somebody else got the window first.")
    public QtimeDtos.BookingResponse book(@Valid @RequestBody QtimeDtos.CreateBookingRequest request) {
        AuthenticatedUser user = currentUser.require();
        String key = IdempotencyGuard.requireKey();
        CreateBookingCommand command = new CreateBookingCommand(request.specialistId(), request.serviceId(),
                request.startsAt(), request.comment());
        return idempotencyGuard.execute(key, request, QtimeDtos.BookingResponse.class,
                () -> mapper.toBooking(bookings.book(user, command))).body();
    }

    @GetMapping
    @Operation(summary = "List bookings, newest first",
            description = "The caller's own appointments; SUPPORT and ADMIN see everybody's. `status` filters by "
                    + "CONFIRMED, CANCELLED_BY_CLIENT, CANCELLED_BY_COMPANY, COMPLETED or NO_SHOW.")
    public PageResponse<QtimeDtos.BookingResponse> list(
            @Parameter(description = "Filter by booking status") @RequestParam(required = false) BookingStatus status,
            @Parameter(description = "Zero-based page index") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size, 1..100") @RequestParam(defaultValue = "20") int size) {

        PageResponse<BookingWithNames> found = bookings.list(currentUser.require(), status, page, clamp(size));
        return PageResponse.of(found.items(), found.page(), found.size(), found.totalElements(),
                mapper::toBooking);
    }

    @GetMapping("/{bookingId}")
    @Operation(summary = "One booking", description = "Owner, SUPPORT or ADMIN only; anyone else gets 403.")
    public QtimeDtos.BookingResponse get(@PathVariable String bookingId) {
        return mapper.toBooking(bookings.get(currentUser.require(), bookingId));
    }

    /**
     * Cancels a booking and frees the window.
     *
     * <p>{@code Idempotency-Key} is honoured when present but not required, like the
     * order service's cancel: the retry of a successful cancellation would otherwise be
     * answered with {@code 409 BOOKING_NOT_CANCELLABLE}, which reads as a failure to a
     * client that in fact succeeded.
     */
    @PostMapping("/{bookingId}/cancel")
    @Operation(summary = "Cancel a booking",
            description = "The client's own booking becomes CANCELLED_BY_CLIENT; a MERCHANT or ADMIN cancels as "
                    + "the company and produces CANCELLED_BY_COMPANY. The window is free again immediately. "
                    + "409 BOOKING_NOT_CANCELLABLE once the booking is completed, missed or already cancelled.")
    public QtimeDtos.BookingResponse cancel(@PathVariable String bookingId,
                                            @Valid @RequestBody(required = false)
                                            QtimeDtos.CancelBookingRequest request) {
        AuthenticatedUser user = currentUser.require();
        String reason = request == null ? null : request.reason();
        Optional<String> key = IdempotencyContext.optional();
        return key.map(idempotencyKey -> idempotencyGuard
                        .execute(idempotencyKey, new CancelCommand(bookingId, reason),
                                QtimeDtos.BookingResponse.class,
                                () -> mapper.toBooking(bookings.cancel(user, bookingId, reason)))
                        .body())
                .orElseGet(() -> mapper.toBooking(bookings.cancel(user, bookingId, reason)));
    }

    private static int clamp(int size) {
        return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    }

    /** What a retried cancellation is hashed against: the booking and the reason. */
    private record CancelCommand(String bookingId, String reason) {
    }
}
