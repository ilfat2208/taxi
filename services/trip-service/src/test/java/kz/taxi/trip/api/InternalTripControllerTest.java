package kz.taxi.trip.api;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import kz.taxi.trip.application.TripDetails;
import kz.taxi.trip.application.TripQueryService;
import kz.taxi.trip.application.TripSagaService;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.domain.TripStatus;
import kz.taxi.trip.domain.TripTransition;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
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
 * The workload API: the four lifecycle steps dispatch and the driver app drive.
 *
 * <p>Two things are checked here that are properties of this endpoint specifically. It needs
 * no user token at all — it has no {@code CurrentUser} dependency, and the tests prove that by
 * calling it with no authentication whatsoever. And every step is repeatable: the controller
 * tests assert the routing, while the repeatability itself lives in the saga and is covered
 * there.
 */
class InternalTripControllerTest {

    private static final String TRIP_ID = "01HTRIP000000000000000001";

    private TripSagaService saga;
    private TripQueryService queries;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        saga = mock(TripSagaService.class);
        queries = mock(TripQueryService.class);
        mockMvc = MockMvcBuilders
                .standaloneSetup(new InternalTripController(saga, queries,
                        new TripMapper(Clock.fixed(TestTrips.NOW, ZoneOffset.UTC))))
                .setControllerAdvice(new GlobalExceptionHandler("https://docs.taxi.local/errors"))
                .build();
    }

    private static TripDetails details(Trip trip) {
        return new TripDetails(trip, List.of(TripTransition.of(trip.getId(), null, TripStatus.SEARCHING,
                TripTransition.ACTOR_RIDER, null, TestTrips.NOW)));
    }

    @Test
    @DisplayName("assign claims a driver for a waiting request, with no user token involved")
    void assign_works_without_a_user() throws Exception {
        Trip assigned = TestTrips.assigned();
        when(saga.assign(eq(TRIP_ID), eq("D-1"), any(), any(), eq(TripTransition.ACTOR_DISPATCHER)))
                .thenReturn(assigned);
        when(queries.internalDetails(assigned.getId())).thenReturn(details(assigned));

        mockMvc.perform(post("/api/v1/trips/internal/{id}/assign", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"driverId":"D-1","driverName":"Айдар"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ASSIGNED"))
                .andExpect(jsonPath("$.driverId").value(TestTrips.DRIVER))
                .andExpect(jsonPath("$.holdStatus").value("ACTIVE"));
    }

    @Test
    @DisplayName("an assign body without a driver is refused at the boundary")
    void assign_needs_a_driver() throws Exception {
        mockMvc.perform(post("/api/v1/trips/internal/{id}/assign", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());

        verify(saga, never()).assign(anyString(), any(), any(), any(), anyString());
    }

    @Test
    @DisplayName("arrive, start and complete reach the saga with the driver as the actor")
    void the_lifecycle_steps_reach_the_saga() throws Exception {
        Trip arrived = TestTrips.arrived();
        Trip started = TestTrips.inProgress();
        Trip completed = TestTrips.completed();
        when(saga.arrive(TRIP_ID, TripTransition.ACTOR_DRIVER)).thenReturn(arrived);
        when(saga.start(TRIP_ID, TripTransition.ACTOR_DRIVER)).thenReturn(started);
        when(saga.complete(TRIP_ID, TripTransition.ACTOR_DRIVER)).thenReturn(completed);
        when(queries.internalDetails(anyString())).thenReturn(details(arrived), details(started), details(completed));

        mockMvc.perform(post("/api/v1/trips/internal/{id}/arrive", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARRIVED"));
        mockMvc.perform(post("/api/v1/trips/internal/{id}/start", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));
        mockMvc.perform(post("/api/v1/trips/internal/{id}/complete", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.holdStatus").value("CAPTURED"));

        verify(saga).arrive(TRIP_ID, TripTransition.ACTOR_DRIVER);
        verify(saga).start(TRIP_ID, TripTransition.ACTOR_DRIVER);
        verify(saga).complete(TRIP_ID, TripTransition.ACTOR_DRIVER);
    }

    @Test
    @DisplayName("the internal read returns the ride with its timeline and no owner check")
    void the_internal_read_has_no_owner_check() throws Exception {
        Trip assigned = TestTrips.assigned();
        when(queries.internalDetails(TRIP_ID)).thenReturn(new TripDetails(assigned, List.of(
                TripTransition.of(TRIP_ID, null, TripStatus.SEARCHING, TripTransition.ACTOR_RIDER, null,
                        TestTrips.NOW),
                TripTransition.of(TRIP_ID, TripStatus.SEARCHING, TripStatus.ASSIGNED,
                        TripTransition.ACTOR_DISPATCHER, "driver D-1", TestTrips.NOW.plusSeconds(20)))));

        mockMvc.perform(get("/api/v1/trips/internal/{id}", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ASSIGNED"))
                .andExpect(jsonPath("$.timeline[1].actor").value("dispatcher"))
                .andExpect(jsonPath("$.holdId").value("H-1"));
    }

    @Test
    @DisplayName("an unknown ride is a 404 for a workload too")
    void an_unknown_ride_is_a_404() throws Exception {
        when(queries.internalDetails("TRIP-NONE"))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_FOUND, "trip not found"));

        mockMvc.perform(get("/api/v1/trips/internal/{id}", "TRIP-NONE"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TRIP_NOT_FOUND"));
    }

    @Test
    @DisplayName("a ride that is not waiting for a driver is a 409 with a code, not a 500")
    void a_ride_that_cannot_be_assigned_is_a_409() throws Exception {
        when(saga.assign(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_ASSIGNABLE, "already has a driver"));

        mockMvc.perform(post("/api/v1/trips/internal/{id}/assign", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"driverId":"D-2"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TRIP_NOT_ASSIGNABLE"));
    }
}
