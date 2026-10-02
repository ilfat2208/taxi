package kz.taxi.qtime.api;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.qtime.QtimeFixtures;
import kz.taxi.qtime.application.SlotService;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Slot;
import kz.taxi.qtime.domain.SlotGrid;
import kz.taxi.qtime.domain.SlotUnavailability;
import kz.taxi.qtime.domain.Specialist;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The slot grid endpoint.
 *
 * <p>The shape is the contract with the mockup: a taken cell is still in the list, with
 * {@code available: false} and the word "занято" — the screen draws the grid from this
 * answer, and a cell that disappeared would be indistinguishable from a day that has no
 * working hours at all.
 */
class SlotControllerTest {

    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);
    private final ServiceItem service = QtimeFixtures.service(company, 90, 450_000L);

    private SlotService slots;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        slots = mock(SlotService.class);
        mockMvc = ApiTestSupport.standalone(new SlotController(slots, new QtimeMapper()));
    }

    private SlotGrid grid() {
        return new SlotGrid(specialist.getId(), service.getId(), 90, "Asia/Almaty", QtimeFixtures.DATE,
                List.of(
                        Slot.free(QtimeFixtures.at(LocalTime.of(9, 0)), QtimeFixtures.at(LocalTime.of(10, 30))),
                        Slot.taken(QtimeFixtures.at(LocalTime.of(10, 30)),
                                QtimeFixtures.at(LocalTime.of(12, 0)), SlotUnavailability.BUSY),
                        Slot.taken(QtimeFixtures.at(LocalTime.of(12, 30)),
                                QtimeFixtures.at(LocalTime.of(14, 0)), SlotUnavailability.BREAK)));
    }

    @Test
    @DisplayName("GET slots returns free and taken cells with the service duration and the zone")
    void returns_the_grid() throws Exception {
        when(slots.slots(eq(specialist.getId()), eq(service.getId()), eq(QtimeFixtures.DATE)))
                .thenReturn(grid());

        mockMvc.perform(get("/api/v1/qtime/specialists/{id}/slots", specialist.getId())
                        .param("serviceId", service.getId())
                        .param("date", "2026-05-14"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.date").value("2026-05-14"))
                .andExpect(jsonPath("$.specialistId").value(specialist.getId()))
                .andExpect(jsonPath("$.serviceId").value(service.getId()))
                .andExpect(jsonPath("$.durationMinutes").value(90))
                .andExpect(jsonPath("$.timezone").value("Asia/Almaty"))
                .andExpect(jsonPath("$.slots[0].available").value(true))
                // A free cell carries no reason at all; the field is null, not a phrase.
                .andExpect(jsonPath("$.slots[0].reason").value(nullValue()))
                .andExpect(jsonPath("$.slots[1].available").value(false))
                // The word the screen puts on a greyed-out cell.
                .andExpect(jsonPath("$.slots[1].reason").value("занято"))
                .andExpect(jsonPath("$.slots[2].reason").value("перерыв"))
                .andExpect(jsonPath("$.slots[0].startsAt").value("2026-05-14T04:00:00Z"))
                .andExpect(jsonPath("$.slots[0].endsAt").value("2026-05-14T05:30:00Z"));
    }

    @Test
    @DisplayName("a missing date is a 400")
    void requires_a_date() throws Exception {
        mockMvc.perform(get("/api/v1/qtime/specialists/{id}/slots", specialist.getId())
                        .param("serviceId", service.getId()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    @DisplayName("a malformed date is a 400, not a 500")
    void rejects_a_malformed_date() throws Exception {
        mockMvc.perform(get("/api/v1/qtime/specialists/{id}/slots", specialist.getId())
                        .param("serviceId", service.getId())
                        .param("date", "14-05-2026"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    @DisplayName("an unknown specialist is a 404")
    void unknown_specialist_is_not_found() throws Exception {
        when(slots.slots(eq("01MISSING"), eq(service.getId()), eq(QtimeFixtures.DATE)))
                .thenThrow(DomainException.of(QtimeErrorCode.SPECIALIST_NOT_FOUND, "no such master"));

        mockMvc.perform(get("/api/v1/qtime/specialists/01MISSING/slots")
                        .param("serviceId", service.getId())
                        .param("date", "2026-05-14"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SPECIALIST_NOT_FOUND"));
    }

    @Test
    @DisplayName("a date beyond the horizon is a 422")
    void date_beyond_the_horizon_is_unprocessable() throws Exception {
        LocalDate far = QtimeFixtures.DATE.plusDays(60);
        when(slots.slots(eq(specialist.getId()), eq(service.getId()), eq(far)))
                .thenThrow(DomainException.of(QtimeErrorCode.OUTSIDE_BOOKING_HORIZON, "too far ahead"));

        mockMvc.perform(get("/api/v1/qtime/specialists/{id}/slots", specialist.getId())
                        .param("serviceId", service.getId())
                        .param("date", far.toString()))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("OUTSIDE_BOOKING_HORIZON"));
    }
}
