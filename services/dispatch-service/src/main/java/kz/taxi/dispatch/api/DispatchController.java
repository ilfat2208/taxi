package kz.taxi.dispatch.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.dispatch.api.dto.DispatchDtos;
import kz.taxi.dispatch.application.DispatchAccess;
import kz.taxi.dispatch.application.FleetService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The dispatcher's view of the fleet.
 *
 * <p>Read-only on purpose in Ф1: assigning trips by hand arrives with the trips
 * themselves (Ф2). Both endpoints require the DISPATCHER, SUPPORT or ADMIN role —
 * a rider has no business seeing where the cars are.
 */
@RestController
@RequestMapping("/api/v1/dispatch")
@Tag(name = "Dispatch", description = "Live fleet and candidate search")
public class DispatchController {

    private final FleetService fleetService;
    private final DispatchMapper mapper;
    private final CurrentUser currentUser;

    public DispatchController(FleetService fleetService,
                              DispatchMapper mapper,
                              CurrentUser currentUser) {
        this.fleetService = fleetService;
        this.mapper = mapper;
        this.currentUser = currentUser;
    }

    @GetMapping("/drivers")
    @Operation(summary = "Every driver on duty with his last known position")
    public DispatchDtos.FleetResponse drivers(
            @RequestParam(name = "includeStale", defaultValue = "true") boolean includeStale) {
        AuthenticatedUser user = currentUser.require();
        DispatchAccess.requireFleetReader(user);
        return mapper.toResponse(fleetService.snapshot(includeStale));
    }

    @GetMapping("/nearest")
    @Operation(summary = "Drivers who may take a trip at this point, nearest first")
    public DispatchDtos.NearestResponse nearest(
            @RequestParam(name = "lat") double lat,
            @RequestParam(name = "lon") double lon,
            @RequestParam(name = "radiusM", defaultValue = "0") int radiusM,
            @RequestParam(name = "limit", defaultValue = "0") int limit) {
        AuthenticatedUser user = currentUser.require();
        DispatchAccess.requireFleetReader(user);
        return mapper.toResponse(fleetService.candidates(lat, lon, radiusM, limit));
    }
}
