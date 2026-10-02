package kz.taxi.trip.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.application.QuoteService;
import kz.taxi.trip.application.TripDetails;
import kz.taxi.trip.application.TripQueryService;
import kz.taxi.trip.application.TripSagaService;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripStatus;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The rider's API, plus the dispatcher's two actions on a ride.
 *
 * <p>Thin by design: no business rule, no transaction boundary and no status code
 * invented here. The one thing a controller <em>does</em> own is idempotency — ordering
 * a ride requires an {@code Idempotency-Key} and wraps the use case in
 * {@link IdempotencyGuard}, so a retried order replays the stored answer instead of
 * creating a second trip and reserving a second fare. (Wrapping here rather than inside
 * the saga is what lets the guard see the request body it has to hash.)
 *
 * <p>Authorization is delegated to {@link kz.taxi.trip.application.TripAccess} rather than
 * expressed as URL patterns: who may assign a car and who may cancel somebody's ride are
 * business decisions that must be testable without an HTTP request.
 */
@RestController
@RequestMapping("/api/v1/trips")
@Tag(name = "Trips", description = "Quotes, ride requests, the ride lifecycle and the check")
public class TripController {

    private final QuoteService quotes;
    private final TripSagaService saga;
    private final TripQueryService queries;
    private final TripMapper mapper;
    private final CurrentUser currentUser;
    private final IdempotencyGuard idempotencyGuard;

    public TripController(QuoteService quotes,
                          TripSagaService saga,
                          TripQueryService queries,
                          TripMapper mapper,
                          CurrentUser currentUser,
                          IdempotencyGuard idempotencyGuard) {
        this.quotes = quotes;
        this.saga = saga;
        this.queries = queries;
        this.mapper = mapper;
        this.currentUser = currentUser;
        this.idempotencyGuard = idempotencyGuard;
    }

    // ------------------------------------------------------------------ ordering

    @PostMapping("/quote")
    @Operation(summary = "Price a ride",
            description = "Estimates the route, applies the tariff and returns a price held for "
                    + "taxi.trip.quote-ttl (5 minutes by default). Requires the CUSTOMER role and an "
                    + "active KZT account: the quote is anchored to the wallet it will be paid from. "
                    + "Nothing is reserved here — a rider may ask for ten prices in a row for free.")
    public TripDtos.QuoteResponse quote(@Valid @RequestBody TripDtos.QuoteRequest request) {
        AuthenticatedUser rider = currentUser.require();
        Quote quote = quotes.quote(rider, request);
        return mapper.toResponse(quote);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Order the ride priced by a quote",
            description = "Creates the trip, reserves the fare on the rider's account and immediately tries "
                    + "to claim the nearest available driver. The answer is the trip itself: ASSIGNED when a car "
                    + "was found, and NO_DRIVERS_FOUND when the city had none — the honest answer, not an error. "
                    + "422 INSUFFICIENT_FUNDS when the rider's wallet refuses, in which case the trip is left "
                    + "closed as CANCELLED_BY_RIDER with the reason. Requires the Idempotency-Key header; the same "
                    + "key never creates a second trip.")
    public TripDtos.TripRequestedResponse request(@Valid @RequestBody TripDtos.CreateTripRequest request) {
        AuthenticatedUser rider = currentUser.require();
        String key = IdempotencyGuard.requireKey();
        return idempotencyGuard.execute(key, request, TripDtos.TripRequestedResponse.class,
                () -> mapper.toRequestedResponse(saga.request(rider, request, key))).body();
    }

    // ------------------------------------------------------------------ reading

    @GetMapping("/{tripId}")
    @Operation(summary = "One ride with its full timeline",
            description = "The rider, SUPPORT or ADMIN. For a completed ride the body also contains the "
                    + "receipt — the very object the receipt endpoint returns.")
    public TripDtos.TripResponse get(@PathVariable String tripId) {
        TripDetails details = queries.details(currentUser.require(), tripId);
        return mapper.toResponse(details);
    }

    @GetMapping("/{tripId}/receipt")
    @Operation(summary = "The check of a completed ride",
            description = "Who paid what: the route, the three parts of the price, the platform's commission "
                    + "and what the driver earned. Available to the rider, SUPPORT and ADMIN; 409 while the ride "
                    + "is still moving, because a receipt is the record of something that happened.")
    public TripDtos.ReceiptResponse receipt(@PathVariable String tripId) {
        return mapper.toReceipt(queries.receipt(currentUser.require(), tripId));
    }

    @GetMapping
    @Operation(summary = "Trips, newest first",
            description = "A CUSTOMER sees his own rides only, whatever filter he sends. A DISPATCHER sees every "
                    + "live request (and can narrow it with status). SUPPORT and ADMIN see everything, any status.")
    public PageResponse<TripDtos.TripSummaryResponse> list(
            @Parameter(description = "Narrow the list to one status")
            @RequestParam(required = false) TripStatus status,
            @Parameter(description = "Zero-based page index") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size, 1..100") @RequestParam(defaultValue = "20") int size) {
        return mapper.toSummaryPage(queries.list(currentUser.require(), status, page, size));
    }

    // ------------------------------------------------------------------ rider's actions

    @PostMapping("/{tripId}/cancel")
    @Operation(summary = "Call the ride off",
            description = "The rider, a DISPATCHER, SUPPORT or an ADMIN. A reason is mandatory for everybody "
                    + "except the rider himself, and cancelledBy (RIDER|DRIVER, operators only) records whose side "
                    + "it came from. The reserved fare is released. Refused with 409 once the ride is IN_PROGRESS: "
                    + "the fare is owed from that moment, whatever the role.")
    public TripDtos.TripResponse cancel(@PathVariable String tripId,
                                        @Valid @RequestBody(required = false) TripDtos.CancelTripRequest request) {
        AuthenticatedUser caller = currentUser.require();
        TripDtos.CancelTripRequest body = request == null ? new TripDtos.CancelTripRequest(null, null) : request;
        Trip trip = saga.cancel(caller, tripId, body.reason(), body.cancelledBy());
        return mapper.toResponse(queries.details(caller, trip.getId()));
    }

    @PostMapping("/{tripId}/rate")
    @Operation(summary = "Rate a completed ride",
            description = "The rider of the ride, once: stars 1..5 and an optional comment. 409 for a ride that "
                    + "has not completed and 409 for a second rating — a rating is an opinion about one ride, not a "
                    + "field to update.")
    public TripDtos.TripResponse rate(@PathVariable String tripId,
                                      @Valid @RequestBody TripDtos.RateTripRequest request) {
        AuthenticatedUser caller = currentUser.require();
        Trip trip = saga.rate(caller, tripId, request.stars(), request.comment());
        return mapper.toResponse(queries.details(caller, trip.getId()));
    }

    // ------------------------------------------------------------------ dispatcher's action

    @PostMapping("/{tripId}/assign")
    @Operation(summary = "Put a driver on a live request by hand",
            description = "DISPATCHER or ADMIN — this is the dispatcher's answer to a stuck board. Exactly the "
                    + "logic the internal assign calls: the driver must be on duty and free, the fare is reserved, "
                    + "the trip moves SEARCHING -> ASSIGNED and the event goes to the outbox. A repeat with the same "
                    + "driver is a no-op and does not reserve twice.")
    public TripDtos.TripResponse assign(@PathVariable String tripId,
                                        @Valid @RequestBody TripDtos.AssignDriverRequest request) {
        AuthenticatedUser caller = currentUser.require();
        kz.taxi.trip.application.TripAccess.requireAssigner(caller);
        Trip trip = saga.assign(tripId, request.driverId(), request.driverName(), request.vehiclePlate(),
                kz.taxi.trip.domain.TripTransition.ACTOR_DISPATCHER);
        return mapper.toResponse(queries.details(caller, trip.getId()));
    }
}
