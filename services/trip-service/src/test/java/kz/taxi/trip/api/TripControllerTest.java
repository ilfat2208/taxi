package kz.taxi.trip.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.security.Roles;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyKeyFilter;
import kz.taxi.common.web.idempotency.IdempotencyProperties;
import kz.taxi.common.web.idempotency.InMemoryIdempotencyStore;
import kz.taxi.trip.application.QuoteService;
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
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The trip API as a client sees it: the routes, the shapes, the status codes and the doors
 * that are shut.
 *
 * <p>The rules themselves live in the application layer and are tested there; what is
 * checked here is that a refusal actually surfaces as the right problem+json rather than
 * being swallowed by a catch-all into a 500 — a bug this platform has hit before — and that
 * the idempotency header is really wired to the ordering endpoint.
 */
class TripControllerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules();
    private static final String TRIP_ID = "01HTRIP000000000000000001";

    private QuoteService quotes;
    private TripSagaService saga;
    private TripQueryService queries;
    private CurrentUser currentUser;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        quotes = mock(QuoteService.class);
        saga = mock(TripSagaService.class);
        queries = mock(TripQueryService.class);
        currentUser = mock(CurrentUser.class);
        TripMapper mapper = new TripMapper(Clock.fixed(TestTrips.NOW, ZoneOffset.UTC));
        IdempotencyGuard guard = new IdempotencyGuard(
                new InMemoryIdempotencyStore(Duration.ofHours(1)), MAPPER);
        IdempotencyKeyFilter keyFilter = new IdempotencyKeyFilter(
                new IdempotencyProperties(null, Duration.ofHours(1), null, 128,
                        IdempotencyProperties.Store.MEMORY), MAPPER);

        mockMvc = MockMvcBuilders
                .standaloneSetup(new TripController(quotes, saga, queries, mapper, currentUser, guard))
                .setControllerAdvice(new GlobalExceptionHandler("https://docs.taxi.local/errors"))
                .addFilters(keyFilter)
                .build();
    }

    private static AuthenticatedUser customer() {
        return new AuthenticatedUser(TestTrips.RIDER, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    }

    private static AuthenticatedUser dispatcher() {
        return new AuthenticatedUser("U-DISP", "+77009999999", "Диспетчер", Set.of(Roles.DISPATCHER));
    }

    private static TripDetails details(Trip trip) {
        return new TripDetails(trip, List.of(
                TripTransition.of(trip.getId(), null, TripStatus.SEARCHING, TripTransition.ACTOR_RIDER, null,
                        TestTrips.NOW)));
    }

    // ------------------------------------------------------------------ quote

    @Test
    @DisplayName("a quote is priced and returned with its breakdown and its TTL")
    void a_quote_is_returned_with_its_breakdown() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(quotes.quote(any(), any())).thenReturn(TestTrips.quote());

        mockMvc.perform(post("/api/v1/trips/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"pickup":{"lat":43.2389,"lon":76.8897,"address":"Абая 150"},
                                 "dropoff":{"lat":43.2489,"lon":76.8897,"address":"Достык 5"},
                                 "tariff":"ECONOMY"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.quoteId").isNotEmpty())
                .andExpect(jsonPath("$.tariff").value("ECONOMY"))
                .andExpect(jsonPath("$.distanceM").value(5_000))
                .andExpect(jsonPath("$.priceMinor").value(120_000))
                .andExpect(jsonPath("$.currency").value("KZT"))
                .andExpect(jsonPath("$.commissionMinor").value(14_400))
                .andExpect(jsonPath("$.driverNetMinor").value(105_600))
                .andExpect(jsonPath("$.surgeBp").value(0))
                .andExpect(jsonPath("$.breakdown.baseMinor").value(35_000))
                .andExpect(jsonPath("$.breakdown.distanceMinor").value(60_000))
                .andExpect(jsonPath("$.breakdown.timeMinor").value(25_000))
                .andExpect(jsonPath("$.expiresAt").isNotEmpty());
    }

    @Test
    @DisplayName("a body without coordinates is refused at the boundary, before any service call")
    void a_body_without_coordinates_is_a_400() throws Exception {
        when(currentUser.require()).thenReturn(customer());

        mockMvc.perform(post("/api/v1/trips/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"pickup":{"address":"Абая 150"},
                                 "dropoff":{"lat":43.2489,"lon":76.8897},
                                 "tariff":"ECONOMY"}
                                """))
                .andExpect(status().isBadRequest());

        verify(quotes, never()).quote(any(), any());
    }

    @Test
    @DisplayName("a rider without a wallet gets 422 and a code, not a 500")
    void a_missing_wallet_is_a_422() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(quotes.quote(any(), any()))
                .thenThrow(DomainException.of(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND, "no wallet"));

        mockMvc.perform(post("/api/v1/trips/quote")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"pickup":{"lat":43.2389,"lon":76.8897},
                                 "dropoff":{"lat":43.2489,"lon":76.8897},
                                 "tariff":"ECONOMY"}
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("RIDER_ACCOUNT_NOT_FOUND"));
    }

    // ------------------------------------------------------------------ ordering

    @Test
    @DisplayName("ordering a ride answers 202 with the ride and the price")
    void ordering_answers_202() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(saga.request(any(), any(), eq("key-1"))).thenReturn(TestTrips.assigned());

        mockMvc.perform(post("/api/v1/trips")
                        .header("Idempotency-Key", "key-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"quoteId":"Q-1","comment":"позвоните"}
                                """))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.tripId").isNotEmpty())
                .andExpect(jsonPath("$.tripNumber").isNotEmpty())
                .andExpect(jsonPath("$.status").value("ASSIGNED"))
                .andExpect(jsonPath("$.priceMinor").value(120_000))
                .andExpect(jsonPath("$.currency").value("KZT"))
                .andExpect(jsonPath("$.requestedAt").isNotEmpty());
    }

    @Test
    @DisplayName("no cars in the city is a normal 202 with NO_DRIVERS_FOUND, not an error")
    void no_drivers_is_not_an_error() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(saga.request(any(), any(), anyString())).thenReturn(TestTrips.noDriversFound());

        mockMvc.perform(post("/api/v1/trips")
                        .header("Idempotency-Key", "key-2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"quoteId":"Q-1"}
                                """))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("NO_DRIVERS_FOUND"));
    }

    @Test
    @DisplayName("an order without an Idempotency-Key is refused with 400")
    void ordering_without_a_key_is_refused() throws Exception {
        when(currentUser.require()).thenReturn(customer());

        mockMvc.perform(post("/api/v1/trips")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"quoteId":"Q-1"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        verify(saga, never()).request(any(), any(), anyString());
    }

    @Test
    @DisplayName("the same Idempotency-Key replays the stored answer instead of ordering twice")
    void the_same_key_replays_the_answer() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(saga.request(any(), any(), eq("key-3"))).thenReturn(TestTrips.assigned());

        String body = """
                {"quoteId":"Q-1"}
                """;
        mockMvc.perform(post("/api/v1/trips").header("Idempotency-Key", "key-3")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted());
        mockMvc.perform(post("/api/v1/trips").header("Idempotency-Key", "key-3")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("ASSIGNED"));

        verify(saga, times(1)).request(any(), any(), eq("key-3"));
    }

    @Test
    @DisplayName("a refused wallet answers 422 and the ride is closed, not left hanging")
    void insufficient_funds_is_a_422() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(saga.request(any(), any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.INSUFFICIENT_FUNDS, "not enough"));

        mockMvc.perform(post("/api/v1/trips")
                        .header("Idempotency-Key", "key-4")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"quoteId":"Q-1"}
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INSUFFICIENT_FUNDS"));
    }

    // ------------------------------------------------------------------ reading

    @Test
    @DisplayName("a completed ride is returned with its timeline and its receipt")
    void a_completed_ride_carries_the_receipt() throws Exception {
        Trip completed = TestTrips.completed();
        when(currentUser.require()).thenReturn(customer());
        when(queries.details(any(), eq(TRIP_ID))).thenReturn(new TripDetails(completed, List.of(
                TripTransition.of(TRIP_ID, null, TripStatus.SEARCHING, TripTransition.ACTOR_RIDER, null,
                        TestTrips.NOW),
                TripTransition.of(TRIP_ID, TripStatus.IN_PROGRESS, TripStatus.COMPLETED,
                        TripTransition.ACTOR_DRIVER, null, TestTrips.NOW.plusSeconds(900)))));

        mockMvc.perform(get("/api/v1/trips/{id}", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.holdStatus").value("CAPTURED"))
                .andExpect(jsonPath("$.timeline[0].status").value("SEARCHING"))
                .andExpect(jsonPath("$.timeline[1].actor").value("driver"))
                .andExpect(jsonPath("$.receipt.priceMinor").value(120_000))
                .andExpect(jsonPath("$.receipt.driverNetMinor").value(105_600))
                .andExpect(jsonPath("$.receipt.transactionId").value("TX-1"))
                .andExpect(jsonPath("$.receipt.paymentId").isEmpty());
    }

    @Test
    @DisplayName("a live ride carries no receipt — the field is null, not a guess")
    void a_live_ride_has_no_receipt() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(queries.details(any(), eq(TRIP_ID))).thenReturn(details(TestTrips.inProgress()));

        mockMvc.perform(get("/api/v1/trips/{id}", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.receipt").isEmpty());
    }

    @Test
    @DisplayName("an unknown ride is a 404 with the code clients switch on")
    void an_unknown_ride_is_a_404() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(queries.details(any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_FOUND, "trip not found"));

        mockMvc.perform(get("/api/v1/trips/{id}", "TRIP-NONE"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TRIP_NOT_FOUND"));
    }

    @Test
    @DisplayName("somebody else's ride is a 403 problem+json")
    void somebody_elses_ride_is_forbidden() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(queries.details(any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.FORBIDDEN_TRIP_ACCESS, "not yours"));

        mockMvc.perform(get("/api/v1/trips/{id}", TRIP_ID))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN_TRIP_ACCESS"));
    }

    // ------------------------------------------------------------------ receipt

    @Test
    @DisplayName("the check of a completed ride is served on its own endpoint too")
    void the_receipt_endpoint_serves_the_check() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(queries.receipt(any(), eq(TRIP_ID)))
                .thenReturn(kz.taxi.trip.domain.TripReceipt.of(TestTrips.completed()));

        mockMvc.perform(get("/api/v1/trips/{id}/receipt", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tripId").isNotEmpty())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.tariff").value("ECONOMY"))
                .andExpect(jsonPath("$.pickupAddress").value("Абая 150"))
                .andExpect(jsonPath("$.dropoffAddress").value("Достык 5"))
                .andExpect(jsonPath("$.distanceM").value(5_000))
                .andExpect(jsonPath("$.durationS").value(600))
                .andExpect(jsonPath("$.breakdown.baseMinor").value(35_000))
                .andExpect(jsonPath("$.breakdown.distanceMinor").value(60_000))
                .andExpect(jsonPath("$.breakdown.timeMinor").value(25_000))
                .andExpect(jsonPath("$.priceMinor").value(120_000))
                .andExpect(jsonPath("$.commissionBp").value(1_200))
                .andExpect(jsonPath("$.commissionMinor").value(14_400))
                .andExpect(jsonPath("$.driverNetMinor").value(105_600))
                .andExpect(jsonPath("$.currency").value("KZT"))
                .andExpect(jsonPath("$.driverId").value(TestTrips.DRIVER))
                .andExpect(jsonPath("$.driverDisplayName").value("Айдар"))
                .andExpect(jsonPath("$.holdId").value("H-1"))
                .andExpect(jsonPath("$.transactionId").value("TX-1"));
    }

    @Test
    @DisplayName("a receipt for a ride that has not happened yet is a 409, not an empty check")
    void a_receipt_for_a_live_ride_is_a_409() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(queries.receipt(any(), eq(TRIP_ID)))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_COMPLETED, "still moving"));

        mockMvc.perform(get("/api/v1/trips/{id}/receipt", TRIP_ID))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TRIP_NOT_COMPLETED"));
    }

    // ------------------------------------------------------------------ list

    @Test
    @DisplayName("the list carries what a dispatcher's board needs, including the age of the request")
    void the_list_carries_the_board_fields() throws Exception {
        when(currentUser.require()).thenReturn(dispatcher());
        when(queries.list(any(), eq(TripStatus.SEARCHING), anyInt(), anyInt()))
                .thenReturn(kz.taxi.common.core.web.PageResponse.of(List.of(TestTrips.searching()),
                        0, 20, 1));

        mockMvc.perform(get("/api/v1/trips").param("status", "SEARCHING"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].tripNumber").isNotEmpty())
                .andExpect(jsonPath("$.items[0].status").value("SEARCHING"))
                .andExpect(jsonPath("$.items[0].tariff").value("ECONOMY"))
                .andExpect(jsonPath("$.items[0].priceMinor").value(120_000))
                .andExpect(jsonPath("$.items[0].pickup.address").value("Абая 150"))
                .andExpect(jsonPath("$.items[0].pickup.lat").value(43.2389))
                .andExpect(jsonPath("$.items[0].dropoff.address").value("Достык 5"))
                .andExpect(jsonPath("$.items[0].requestedAt").isNotEmpty())
                .andExpect(jsonPath("$.items[0].ageSeconds").isNumber())
                .andExpect(jsonPath("$.totalElements").value(1));

        verify(queries).list(any(), eq(TripStatus.SEARCHING), eq(0), eq(20));
    }

    @Test
    @DisplayName("an unknown status in the query is a 400, not a silent empty page")
    void an_unknown_status_is_a_400() throws Exception {
        when(currentUser.require()).thenReturn(dispatcher());

        mockMvc.perform(get("/api/v1/trips").param("status", "PENDING"))
                .andExpect(status().isBadRequest());

        verify(queries, never()).list(any(), any(), anyInt(), anyInt());
    }

    // ------------------------------------------------------------------ assign and cancel

    @Test
    @DisplayName("a customer may not assign a driver: 403 with the code for it")
    void a_customer_cannot_assign() throws Exception {
        when(currentUser.require()).thenReturn(customer());

        mockMvc.perform(post("/api/v1/trips/{id}/assign", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"driverId":"D-1"}
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN_TRIP_ASSIGNMENT"));

        verify(saga, never()).assign(anyString(), anyString(), any(), any(), anyString());
    }

    @Test
    @DisplayName("a dispatcher assigns a car and gets the ride back")
    void a_dispatcher_assigns_a_car() throws Exception {
        Trip assigned = TestTrips.assigned();
        when(currentUser.require()).thenReturn(dispatcher());
        when(saga.assign(eq(TRIP_ID), eq("D-1"), any(), any(), eq(TripTransition.ACTOR_DISPATCHER)))
                .thenReturn(assigned);
        when(queries.details(any(), eq(assigned.getId()))).thenReturn(details(assigned));

        mockMvc.perform(post("/api/v1/trips/{id}/assign", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"driverId":"D-1","driverName":"Айдар"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ASSIGNED"))
                .andExpect(jsonPath("$.driverId").value(TestTrips.DRIVER));
    }

    @Test
    @DisplayName("a busy driver is a 409 the dispatcher can act on")
    void a_busy_driver_is_a_409() throws Exception {
        when(currentUser.require()).thenReturn(dispatcher());
        when(saga.assign(anyString(), anyString(), any(), any(), anyString()))
                .thenThrow(DomainException.of(TripErrorCode.DRIVER_NOT_AVAILABLE, "busy"));

        mockMvc.perform(post("/api/v1/trips/{id}/assign", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"driverId":"D-1"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DRIVER_NOT_AVAILABLE"));
    }

    @Test
    @DisplayName("a ride in progress cannot be cancelled: 409 with the code that says why")
    void cancelling_a_ride_in_progress_is_a_409() throws Exception {
        when(currentUser.require()).thenReturn(customer());
        when(saga.cancel(any(), eq(TRIP_ID), any(), any()))
                .thenThrow(DomainException.of(TripErrorCode.TRIP_NOT_CANCELLABLE, "the ride is IN_PROGRESS"));

        mockMvc.perform(post("/api/v1/trips/{id}/cancel", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"reason":"передумал"}
                                """))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TRIP_NOT_CANCELLABLE"));
    }

    @Test
    @DisplayName("a cancellation without a body is still the rider's own decision")
    void a_cancellation_needs_no_body() throws Exception {
        Trip cancelled = TestTrips.cancelledByRider();
        when(currentUser.require()).thenReturn(customer());
        when(saga.cancel(any(), eq(TRIP_ID), eq(null), eq(null))).thenReturn(cancelled);
        when(queries.details(any(), eq(cancelled.getId()))).thenReturn(details(cancelled));

        mockMvc.perform(post("/api/v1/trips/{id}/cancel", TRIP_ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED_BY_RIDER"))
                .andExpect(jsonPath("$.holdStatus").value("RELEASED"));
    }

    @Test
    @DisplayName("a rating outside the scale is refused at the boundary")
    void a_rating_outside_the_scale_is_a_400() throws Exception {
        when(currentUser.require()).thenReturn(customer());

        mockMvc.perform(post("/api/v1/trips/{id}/rate", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"stars":7}
                                """))
                .andExpect(status().isBadRequest());

        verify(saga, never()).rate(any(), anyString(), anyInt(), any());
    }

    @Test
    @DisplayName("the rider's rating is accepted and comes back on the ride")
    void a_rating_is_accepted() throws Exception {
        Trip completed = TestTrips.completed();
        completed.rate(5, "отличный водитель", TestTrips.NOW.plusSeconds(1_000));
        when(currentUser.require()).thenReturn(customer());
        when(saga.rate(any(), eq(TRIP_ID), eq(5), eq("отличный водитель"))).thenReturn(completed);
        when(queries.details(any(), eq(completed.getId()))).thenReturn(details(completed));

        mockMvc.perform(post("/api/v1/trips/{id}/rate", TRIP_ID)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"stars":5,"comment":"отличный водитель"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ratingStars").value(5))
                .andExpect(jsonPath("$.ratingComment").value("отличный водитель"));
    }
}
