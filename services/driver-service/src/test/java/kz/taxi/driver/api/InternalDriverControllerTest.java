package kz.taxi.driver.api;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import kz.taxi.driver.application.DriverApplicationService;
import kz.taxi.driver.domain.DocumentKind;
import kz.taxi.driver.domain.Driver;
import kz.taxi.driver.domain.DriverDocument;
import kz.taxi.driver.domain.DriverErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The internal trip endpoints, as trip-service calls them.
 *
 * <p>What matters here is the contract on duty state: claiming a driver makes him BUSY and
 * takes him off the market, releasing him puts him back to ONLINE — and a refusal arrives as
 * a problem+json with the code the caller switches on, because that code is what decides
 * whether the ride tries the next car or fails.
 */
class InternalDriverControllerTest {

    private static final Instant NOW = Instant.parse("2025-05-01T10:00:00Z");

    private final DriverApplicationService driverService = mock(DriverApplicationService.class);
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(new InternalDriverController(driverService))
                .setControllerAdvice(new GlobalExceptionHandler("https://docs.taxi.local/errors"))
                .build();
    }

    private static Driver busyDriver(String tripId) {
        Driver driver = Driver.register("U-1", "+77001234567", "Айдар", NOW);
        driver.goOnDuty(validDocuments(driver.getId()), NOW);
        driver.assignTrip(tripId, NOW);
        return driver;
    }

    /** The papers the duty rule requires: without them a driver cannot go on duty at all. */
    private static java.util.List<DriverDocument> validDocuments(String driverId) {
        return java.util.List.of(
                DriverDocument.issue(driverId, DocumentKind.DRIVING_LICENCE,
                        NOW.plus(java.time.Duration.ofDays(300)), NOW),
                DriverDocument.issue(driverId, DocumentKind.VEHICLE_INSPECTION,
                        NOW.plus(java.time.Duration.ofDays(90)), NOW),
                DriverDocument.issue(driverId, DocumentKind.MEDICAL_CHECK,
                        NOW.plus(java.time.Duration.ofDays(30)), NOW));
    }

    @Test
    @DisplayName("a claim puts the driver on the trip and answers with his new state")
    void a_claim_returns_the_new_state() throws Exception {
        when(driverService.assignTrip(eq("D-1"), eq("TRIP-1"))).thenReturn(busyDriver("TRIP-1"));

        mockMvc.perform(post("/api/v1/drivers/internal/{driverId}/trip", "D-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tripId":"TRIP-1"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.driverId").isNotEmpty())
                .andExpect(jsonPath("$.status").value("BUSY"))
                .andExpect(jsonPath("$.currentTripId").value("TRIP-1"))
                .andExpect(jsonPath("$.onDuty").value(true))
                .andExpect(jsonPath("$.available").value(false));
    }

    @Test
    @DisplayName("a claim without a trip is refused at the boundary")
    void a_claim_needs_a_trip() throws Exception {
        mockMvc.perform(post("/api/v1/drivers/internal/{driverId}/trip", "D-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());

        verify(driverService, never()).assignTrip(anyString(), anyString());
    }

    @Test
    @DisplayName("a driver who is not free produces the 409 the ride's search expects")
    void a_busy_driver_is_a_409() throws Exception {
        when(driverService.assignTrip(anyString(), anyString()))
                .thenThrow(DomainException.of(DriverErrorCode.DRIVER_ALREADY_ON_TRIP, "already on a trip"));

        mockMvc.perform(post("/api/v1/drivers/internal/{driverId}/trip", "D-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tripId":"TRIP-1"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DRIVER_ALREADY_ON_TRIP"));
    }

    @Test
    @DisplayName("a release puts the driver back on duty, available for the next trip")
    void a_release_returns_the_driver_to_duty() throws Exception {
        Driver driver = busyDriver("TRIP-1");
        driver.finishTrip(NOW);
        when(driverService.finishTrip("D-1")).thenReturn(driver);

        mockMvc.perform(delete("/api/v1/drivers/internal/{driverId}/trip", "D-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ONLINE"))
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.onDuty").value(true))
                .andExpect(jsonPath("$.completedTrips").value(1))
                .andExpect(jsonPath("$.currentTripId").isEmpty());

        verify(driverService).finishTrip("D-1");
    }

    @Test
    @DisplayName("releasing a driver with no trip is a 409 with the code a retry recognises")
    void releasing_a_free_driver_is_a_409() throws Exception {
        when(driverService.finishTrip(anyString()))
                .thenThrow(DomainException.of(DriverErrorCode.DRIVER_HAS_NO_TRIP, "no active trip"));

        mockMvc.perform(delete("/api/v1/drivers/internal/{driverId}/trip", "D-1"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DRIVER_HAS_NO_TRIP"));
    }

    @Test
    @DisplayName("an unknown driver is a 404, and no state is invented for him")
    void an_unknown_driver_is_a_404() throws Exception {
        when(driverService.assignTrip(anyString(), anyString()))
                .thenThrow(DomainException.of(DriverErrorCode.DRIVER_NOT_FOUND, "no such driver"));

        mockMvc.perform(post("/api/v1/drivers/internal/{driverId}/trip", "D-NONE")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"tripId":"TRIP-1"}
                                """))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("DRIVER_NOT_FOUND"));
    }
}
