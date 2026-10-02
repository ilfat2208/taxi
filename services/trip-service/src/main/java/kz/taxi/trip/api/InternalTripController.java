package kz.taxi.trip.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.application.TripSagaService;
import kz.taxi.trip.application.TripQueryService;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripTransition;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service trip control.
 *
 * <p>Reached only through the platform's internal-token filter (the path contains
 * {@code /internal/}) and never routed by the public gateway. There is no user token
 * here on purpose: the driver-app side of the lifecycle is driven by a value — a
 * position, a status — and not by a user who owns the ride. The driver's own token says
 * "this is driver X", which is exactly the wrong authority for "mark trip T as started":
 * the role-based check a user token could express is not the check that is needed.
 *
 * <p>Every call is safe to repeat: {@code assign} with the same driver does not reserve
 * the fare twice, and arriving, starting or completing an already-arrived, already-started
 * or already-completed ride is a no-op. Dispatch and the driver app retry; a retried
 * lifecycle step must never move money or a car again.
 *
 * <p>Note what is deliberately <em>not</em> here: cancelling. A ride is called off through
 * the public endpoint, where the caller's roles decide whether a reason is required —
 * two doors to one decision is one door too many.
 */
@RestController
@RequestMapping("/api/v1/trips/internal")
@Tag(name = "Trips (internal)", description = "Called by dispatch-service; protected by X-Internal-Token")
public class InternalTripController {

    private final TripSagaService saga;
    private final TripQueryService queries;
    private final TripMapper mapper;

    public InternalTripController(TripSagaService saga, TripQueryService queries, TripMapper mapper) {
        this.saga = saga;
        this.queries = queries;
        this.mapper = mapper;
    }

    @PostMapping("/{tripId}/assign")
    @Operation(summary = "Put a driver on a waiting request",
            description = "The same logic the dispatcher's endpoint calls. The driver must be on duty and free; "
                    + "the fare is reserved on the rider's account before the car is claimed, and a repeated call "
                    + "with the same driver does nothing.")
    public TripDtos.TripResponse assign(@PathVariable String tripId,
                                        @Valid @RequestBody TripDtos.AssignDriverRequest request) {
        Trip trip = saga.assign(tripId, request.driverId(), request.driverName(), request.vehiclePlate(),
                TripTransition.ACTOR_DISPATCHER);
        return mapper.toResponse(queries.internalDetails(trip.getId()));
    }

    @PostMapping("/{tripId}/arrive")
    @Operation(summary = "The car is at the pickup point")
    public TripDtos.TripResponse arrive(@PathVariable String tripId) {
        Trip trip = saga.arrive(tripId, TripTransition.ACTOR_DRIVER);
        return mapper.toResponse(queries.internalDetails(trip.getId()));
    }

    @PostMapping("/{tripId}/start")
    @Operation(summary = "The rider is in the car",
            description = "From this moment the fare is owed and no cancellation is possible.")
    public TripDtos.TripResponse start(@PathVariable String tripId) {
        Trip trip = saga.start(tripId, TripTransition.ACTOR_DRIVER);
        return mapper.toResponse(queries.internalDetails(trip.getId()));
    }

    @PostMapping("/{tripId}/complete")
    @Operation(summary = "The ride happened and the fare is captured",
            description = "Turns the reserved fare into a real charge and releases the driver. Repeating it "
                    + "replays the original capture instead of charging twice.")
    public TripDtos.TripResponse complete(@PathVariable String tripId) {
        Trip trip = saga.complete(tripId, TripTransition.ACTOR_DRIVER);
        return mapper.toResponse(queries.internalDetails(trip.getId()));
    }

    @GetMapping("/{tripId}")
    @Operation(summary = "One ride, for a workload",
            description = "No owner check: the caller is a service, and the consumer decides who it shows the "
                    + "ride to. Used by dispatch while matching a car to a waiting request.")
    public TripDtos.TripResponse get(@PathVariable String tripId) {
        return mapper.toResponse(queries.internalDetails(tripId));
    }
}
