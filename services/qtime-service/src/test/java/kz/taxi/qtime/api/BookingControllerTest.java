package kz.taxi.qtime.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.security.Roles;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyKeyFilter;
import kz.taxi.common.web.idempotency.IdempotencyProperties;
import kz.taxi.common.web.idempotency.InMemoryIdempotencyStore;
import kz.taxi.qtime.QtimeFixtures;
import kz.taxi.qtime.application.BookingApplicationService;
import kz.taxi.qtime.application.BookingWithNames;
import kz.taxi.qtime.application.CreateBookingCommand;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.LocalTime;
import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The booking endpoints as a client sees them: routes, status codes and the body.
 *
 * <p>The assertions that matter are about the boundary between the transport and the
 * business layer: a refusal must surface as problem+json with its own code instead of a
 * 500, a missing {@code Idempotency-Key} must be a 400 before anything is booked, and a
 * replayed key must return the first answer rather than a second appointment. The
 * idempotency store here is the real in-memory one, so the replay is genuinely
 * exercised — with a mocked guard those tests would prove nothing.
 */
class BookingControllerTest {

    private static final String CLIENT = "U-1";

    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);
    private final ServiceItem service = QtimeFixtures.service(company, 90, 450_000L);

    private final AuthenticatedUser client =
            new AuthenticatedUser(CLIENT, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    private final AuthenticatedUser merchant =
            new AuthenticatedUser("M-1", "+77009999999", "Салон", Set.of(Roles.MERCHANT));

    private BookingApplicationService bookings;
    private CurrentUser currentUser;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        bookings = mock(BookingApplicationService.class);
        currentUser = mock(CurrentUser.class);
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.findAndRegisterModules();
        // The real in-memory store, so a replayed Idempotency-Key is genuinely replayed
        // here and not just stubbed to look replayed.
        IdempotencyGuard guard = new IdempotencyGuard(
                new InMemoryIdempotencyStore(Duration.ofHours(1)), objectMapper);
        mockMvc = ApiTestSupport.standalone(
                new BookingController(bookings, new QtimeMapper(), currentUser, guard),
                new IdempotencyKeyFilter(
                        new IdempotencyProperties("test:idem:", Duration.ofHours(1), "Idempotency-Key", 128,
                                IdempotencyProperties.Store.MEMORY), objectMapper));
    }

    private BookingWithNames booked() {
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 30));
        return new BookingWithNames(booking, company, specialist, service);
    }

    /** A create body, in bytes-ready JSON, for the fixture window. */
    private String createBody(LocalTime startsAt) {
        return """
                {"specialistId":"%s","serviceId":"%s","startsAt":"%s","comment":"домофон 45"}
                """.formatted(specialist.getId(), service.getId(), QtimeFixtures.at(startsAt));
    }

    // ------------------------------------------------------------------ booking

    @Test
    @DisplayName("POST /bookings returns 201 with the code and the names behind the ids")
    void creates_a_booking() throws Exception {
        BookingWithNames created = booked();
        when(currentUser.require()).thenReturn(client);
        when(bookings.book(eq(client), any(CreateBookingCommand.class))).thenReturn(created);

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .header("Idempotency-Key", "key-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(LocalTime.of(15, 30))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.bookingId").value(created.booking().getId()))
                .andExpect(jsonPath("$.code").value(created.booking().getCode()))
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                // A receipt must be readable without a second request: the ids stay in the
                // body, and so do the names a person actually reads.
                .andExpect(jsonPath("$.companyName").value("Салон красоты «Лотос»"))
                .andExpect(jsonPath("$.specialistName").value("Айгуль Смагулова"))
                .andExpect(jsonPath("$.serviceName").value("Маникюр с покрытием"))
                .andExpect(jsonPath("$.durationMinutes").value(90))
                .andExpect(jsonPath("$.priceMinor").value(450000))
                .andExpect(jsonPath("$.currency").value("KZT"));
    }

    @Test
    @DisplayName("replaying the same Idempotency-Key returns the same booking, not a second one")
    void replaying_the_key_returns_the_same_booking() throws Exception {
        BookingWithNames created = booked();
        when(currentUser.require()).thenReturn(client);
        when(bookings.book(eq(client), any(CreateBookingCommand.class))).thenReturn(created);

        for (int attempt = 0; attempt < 2; attempt++) {
            mockMvc.perform(post("/api/v1/qtime/bookings")
                            .header("Idempotency-Key", "key-same")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(createBody(LocalTime.of(15, 30))))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.bookingId").value(created.booking().getId()));
        }

        // The use case ran once: the duplicate was answered from the stored response.
        verify(bookings).book(eq(client), any(CreateBookingCommand.class));
    }

    @Test
    @DisplayName("POST /bookings without an Idempotency-Key is a 400 and books nothing")
    void requires_an_idempotency_key() throws Exception {
        when(currentUser.require()).thenReturn(client);

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(LocalTime.of(15, 30))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        verify(bookings, never()).book(any(), any());
    }

    @Test
    @DisplayName("a missing startsAt is rejected at the boundary, before any service call")
    void validates_the_body() throws Exception {
        when(currentUser.require()).thenReturn(client);

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .header("Idempotency-Key", "key-body")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"specialistId":"%s","serviceId":"%s"}
                                """.formatted(specialist.getId(), service.getId())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        verify(bookings, never()).book(any(), any());
    }

    @Test
    @DisplayName("a lost race for the window is 409 SLOT_TAKEN, not a 500")
    void taken_window_is_a_conflict() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.book(eq(client), any(CreateBookingCommand.class)))
                .thenThrow(DomainException.of(QtimeErrorCode.SLOT_TAKEN, "already booked"));

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .header("Idempotency-Key", "key-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(LocalTime.of(15, 30))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SLOT_TAKEN"));
    }

    @Test
    @DisplayName("a service this master does not perform is a 400")
    void foreign_service_is_a_bad_request() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.book(eq(client), any(CreateBookingCommand.class)))
                .thenThrow(DomainException.of(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST, "not offered"));

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .header("Idempotency-Key", "key-3")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(LocalTime.of(16, 0))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("SERVICE_NOT_OFFERED_BY_SPECIALIST"));
    }

    @Test
    @DisplayName("a time outside the shift is a 422 with its own code")
    void outside_working_hours_is_unprocessable() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.book(eq(client), any(CreateBookingCommand.class)))
                .thenThrow(DomainException.of(QtimeErrorCode.OUTSIDE_WORKING_HOURS, "closed"));

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .header("Idempotency-Key", "key-4")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(LocalTime.of(22, 0))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("OUTSIDE_WORKING_HOURS"));
    }

    @Test
    @DisplayName("a merchant cannot book: taking a window is the client's action")
    void merchant_cannot_book() throws Exception {
        when(currentUser.require()).thenReturn(merchant);
        when(bookings.book(eq(merchant), any(CreateBookingCommand.class)))
                .thenThrow(DomainException.of(QtimeErrorCode.CUSTOMER_ROLE_REQUIRED, "not a customer"));

        mockMvc.perform(post("/api/v1/qtime/bookings")
                        .header("Idempotency-Key", "key-5")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(LocalTime.of(16, 0))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CUSTOMER_ROLE_REQUIRED"));
    }

    // ------------------------------------------------------------------ reading

    @Test
    @DisplayName("GET /bookings returns the caller's page with pagination metadata")
    void lists_bookings() throws Exception {
        BookingWithNames existing = booked();
        when(currentUser.require()).thenReturn(client);
        when(bookings.list(eq(client), eq(null), eq(0), eq(20)))
                .thenReturn(PageResponse.of(List.of(existing), 0, 20, 1));

        mockMvc.perform(get("/api/v1/qtime/bookings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].code").value(existing.booking().getCode()))
                .andExpect(jsonPath("$.items[0].status").value("CONFIRMED"))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.size").value(20));
    }

    @Test
    @DisplayName("an unknown status filter is rejected at the boundary with 400")
    void unknown_status_is_rejected() throws Exception {
        when(currentUser.require()).thenReturn(client);

        mockMvc.perform(get("/api/v1/qtime/bookings").param("status", "MAYBE"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    @DisplayName("somebody else's booking is 403 for a client")
    void foreign_booking_is_forbidden() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.get(eq(client), eq("B-1")))
                .thenThrow(DomainException.of(QtimeErrorCode.FORBIDDEN_BOOKING_ACCESS, "not yours"));

        mockMvc.perform(get("/api/v1/qtime/bookings/B-1"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN_BOOKING_ACCESS"));
    }

    @Test
    @DisplayName("an unknown booking is a 404")
    void unknown_booking_is_not_found() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.get(eq(client), eq("B-404")))
                .thenThrow(DomainException.of(QtimeErrorCode.BOOKING_NOT_FOUND, "no such booking"));

        mockMvc.perform(get("/api/v1/qtime/bookings/B-404"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_FOUND"));
    }

    @Test
    @DisplayName("a page size above the cap is clamped rather than rejected")
    void page_size_is_clamped() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.list(eq(client), eq(null), eq(0), eq(100))).thenReturn(PageResponse.empty(0, 100));

        mockMvc.perform(get("/api/v1/qtime/bookings").param("size", "5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    // ------------------------------------------------------------------ cancelling

    @Test
    @DisplayName("POST /bookings/{id}/cancel returns the cancelled booking with its reason")
    void cancels_a_booking() throws Exception {
        BookingWithNames existing = booked();
        existing.booking().cancel("заболела", false, QtimeFixtures.at(LocalTime.of(11, 0)));
        when(currentUser.require()).thenReturn(client);
        when(bookings.cancel(eq(client), eq(existing.booking().getId()), eq("заболела")))
                .thenReturn(existing);

        mockMvc.perform(post("/api/v1/qtime/bookings/{id}/cancel", existing.booking().getId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"reason":"заболела"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED_BY_CLIENT"))
                .andExpect(jsonPath("$.cancelReason").value("заболела"));
    }

    @Test
    @DisplayName("cancelling a completed visit is 409")
    void cancelling_a_completed_booking_is_a_conflict() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.cancel(eq(client), eq("B-9"), any()))
                .thenThrow(DomainException.of(QtimeErrorCode.BOOKING_NOT_CANCELLABLE, "completed"));

        mockMvc.perform(post("/api/v1/qtime/bookings/B-9/cancel")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_CANCELLABLE"));
    }

    @Test
    @DisplayName("cancelling somebody else's booking is 403 and changes nothing")
    void cancelling_a_foreign_booking_is_forbidden() throws Exception {
        when(currentUser.require()).thenReturn(client);
        when(bookings.cancel(eq(client), eq("B-2"), eq("не моё")))
                .thenThrow(DomainException.of(QtimeErrorCode.FORBIDDEN_BOOKING_ACCESS, "not yours"));

        mockMvc.perform(post("/api/v1/qtime/bookings/B-2/cancel")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"не моё\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN_BOOKING_ACCESS"));
    }
}
