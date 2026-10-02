package kz.taxi.qtime.api;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.qtime.QtimeFixtures;
import kz.taxi.qtime.application.BookingApplicationService;
import kz.taxi.qtime.application.BookingWithNames;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalTime;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The internal endpoint the company side calls.
 *
 * <p>Authentication itself is the platform's ({@code InternalApiTokenFilter} on
 * {@code X-Internal-Token}, covered by the platform tests): what is checked here is that
 * the endpoint publishes the transition and that a cancelled visit cannot be closed —
 * the two facts ORTA Business depends on when it reconciles its own calendar.
 */
class InternalQtimeControllerTest {

    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);
    private final ServiceItem service = QtimeFixtures.service(company, 90, 450_000L);

    private BookingApplicationService bookings;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        bookings = mock(BookingApplicationService.class);
        mockMvc = ApiTestSupport.standalone(new InternalQtimeController(bookings, new QtimeMapper()));
    }

    @Test
    @DisplayName("POST complete returns the booking as COMPLETED")
    void completes_a_visit() throws Exception {
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 30));
        booking.complete(QtimeFixtures.at(LocalTime.of(17, 0)));
        BookingWithNames completed = new BookingWithNames(booking, company, specialist, service);
        when(bookings.complete(eq(booking.getId()))).thenReturn(completed);

        mockMvc.perform(post("/api/v1/qtime/internal/bookings/{id}/complete", booking.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId").value(booking.getId()))
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.serviceName").value("Маникюр с покрытием"));
    }

    @Test
    @DisplayName("completing a cancelled booking is a 409")
    void refuses_to_complete_a_cancelled_booking() throws Exception {
        when(bookings.complete(eq("B-1")))
                .thenThrow(DomainException.of(QtimeErrorCode.BOOKING_NOT_COMPLETABLE, "cancelled"));

        mockMvc.perform(post("/api/v1/qtime/internal/bookings/B-1/complete"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_COMPLETABLE"));
    }

    @Test
    @DisplayName("an unknown booking is a 404")
    void unknown_booking_is_not_found() throws Exception {
        when(bookings.complete(eq("B-404")))
                .thenThrow(DomainException.of(QtimeErrorCode.BOOKING_NOT_FOUND, "no such booking"));

        mockMvc.perform(post("/api/v1/qtime/internal/bookings/B-404/complete"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("BOOKING_NOT_FOUND"));
    }
}
