package kz.taxi.dispatch.api;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import kz.taxi.dispatch.application.FleetService;
import kz.taxi.dispatch.domain.DispatchErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The workload view of the fleet, which trip-service uses to find a car.
 *
 * <p>What is asserted here is what makes this endpoint different from the dispatcher's:
 * it needs no user token and no role — the caller is a service. The candidate logic itself
 * is {@code FleetService}'s and is covered by {@code FleetServiceTest}; this test proves the
 * route, the parameter defaults and the fact that a refusal from the fleet rules still
 * surfaces as problem+json rather than as a 500.
 */
class InternalDispatchControllerTest {

    private final FleetService fleetService = mock(FleetService.class);
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
                .standaloneSetup(new InternalDispatchController(fleetService, new DispatchMapper()))
                .setControllerAdvice(new GlobalExceptionHandler("https://docs.taxi.local/errors"))
                .build();
    }

    private static FleetService.CandidateList candidates() {
        return new FleetService.CandidateList(Instant.parse("2025-05-01T10:00:00Z"), 3_000, List.of(
                new FleetService.Candidate("D-1", "Айдар", 43.2389d, 76.8897d, 240d, 3L),
                new FleetService.Candidate("D-2", "Ерлан", 43.2400d, 76.8900d, 900d, 8L)));
    }

    @Test
    @DisplayName("a workload asks who is free and gets candidates, nearest first, with no token")
    void a_workload_gets_the_candidates() throws Exception {
        when(fleetService.candidates(anyDouble(), anyDouble(), anyInt(), anyInt())).thenReturn(candidates());

        mockMvc.perform(get("/api/v1/dispatch/internal/nearest")
                        .param("lat", "43.2389")
                        .param("lon", "76.8897")
                        .param("radiusM", "3000")
                        .param("limit", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.radiusM").value(3_000))
                .andExpect(jsonPath("$.candidates[0].driverId").value("D-1"))
                .andExpect(jsonPath("$.candidates[0].displayName").value("Айдар"))
                .andExpect(jsonPath("$.candidates[0].distanceM").value(240.0))
                .andExpect(jsonPath("$.candidates[0].ageSeconds").value(3))
                .andExpect(jsonPath("$.candidates[1].driverId").value("D-2"));

        verify(fleetService).candidates(43.2389d, 76.8897d, 3_000, 5);
    }

    @Test
    @DisplayName("a missing radius and limit mean the configured defaults, like the dispatcher's view")
    void missing_parameters_mean_the_defaults() throws Exception {
        when(fleetService.candidates(anyDouble(), anyDouble(), eq(0), eq(0))).thenReturn(candidates());

        mockMvc.perform(get("/api/v1/dispatch/internal/nearest")
                        .param("lat", "43.2389")
                        .param("lon", "76.8897"))
                .andExpect(status().isOk());

        verify(fleetService).candidates(43.2389d, 76.8897d, 0, 0);
    }

    @Test
    @DisplayName("an empty city is a 200 with an empty list — an answer, not an error")
    void no_cars_is_an_empty_list() throws Exception {
        when(fleetService.candidates(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenReturn(new FleetService.CandidateList(Instant.parse("2025-05-01T10:00:00Z"), 3_000,
                        List.of()));

        mockMvc.perform(get("/api/v1/dispatch/internal/nearest")
                        .param("lat", "43.2389")
                        .param("lon", "76.8897"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.candidates").isEmpty());
    }

    @Test
    @DisplayName("a radius the fleet refuses is a 400 problem+json, never a silent empty list")
    void a_refused_radius_is_a_400() throws Exception {
        when(fleetService.candidates(anyDouble(), anyDouble(), anyInt(), anyInt()))
                .thenThrow(DomainException.of(DispatchErrorCode.INVALID_RADIUS, "radius too large"));

        mockMvc.perform(get("/api/v1/dispatch/internal/nearest")
                        .param("lat", "43.2389")
                        .param("lon", "76.8897")
                        .param("radiusM", "999999"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_RADIUS"));
    }
}
