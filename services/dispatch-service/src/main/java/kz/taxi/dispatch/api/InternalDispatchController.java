package kz.taxi.dispatch.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.dispatch.api.dto.DispatchDtos;
import kz.taxi.dispatch.application.FleetService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service view of the fleet.
 *
 * <p>Reached only through the platform's internal-token filter (the path contains
 * {@code /internal/}) and never routed by the public gateway.
 *
 * <p>Why this exists next to {@link DispatchController}: a trip is not a person. When
 * trip-service looks for a car it has no DISPATCHER role to present — it is a workload
 * acting for a rider — and inventing a user token for it would mean either minting
 * credentials for a service or widening a role until it means nothing. The internal
 * endpoint answers the same question as the dispatcher's, guarded by the workload token
 * instead of a role.
 *
 * <p>No business logic lives here: it delegates to the very same
 * {@link FleetService#candidates} the dispatcher's endpoint calls, so a rider matched
 * automatically and a rider matched by hand are matched by identical rules — fresh
 * position, on duty, not already carrying somebody.
 */
@RestController
@RequestMapping("/api/v1/dispatch/internal")
@Tag(name = "Dispatch (internal)", description = "Called by trip-service; protected by X-Internal-Token")
public class InternalDispatchController {

    private final FleetService fleetService;
    private final DispatchMapper mapper;

    public InternalDispatchController(FleetService fleetService, DispatchMapper mapper) {
        this.fleetService = fleetService;
        this.mapper = mapper;
    }

    @GetMapping("/nearest")
    @Operation(summary = "Available drivers near a point, nearest first",
            description = "The same candidates the dispatcher's endpoint returns, without a role check: the "
                    + "X-Internal-Token header is the authority here. An empty list is a complete answer — the "
                    + "city has no free car at that spot — and is not an error.")
    public DispatchDtos.NearestResponse nearest(
            @RequestParam(name = "lat") double lat,
            @RequestParam(name = "lon") double lon,
            @RequestParam(name = "radiusM", defaultValue = "0") int radiusM,
            @RequestParam(name = "limit", defaultValue = "0") int limit) {
        return mapper.toResponse(fleetService.candidates(lat, lon, radiusM, limit));
    }
}
