package kz.taxi.driver.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.driver.api.dto.InternalDriverDtos;
import kz.taxi.driver.application.DriverApplicationService;
import kz.taxi.driver.domain.Driver;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service API for the trip lifecycle.
 *
 * <p>Reached only through the platform's internal-token filter (the path contains
 * {@code /internal/}) and never routed by the public gateway.
 *
 * <p>Why this exists next to {@link DriverController}: the driver's own endpoints are all
 * about {@code me}, and a trip is claimed by <em>somebody else</em> — trip-service. The
 * caller there is a workload acting for a rider, and no user token can express that
 * authority: it is not the driver asking to be busy, and it is not a dispatcher either.
 * This endpoint is also the reason {@code Driver.assignTrip} was written into the
 * aggregate long before there was a caller for it.
 *
 * <p>Both endpoints delegate straight to the application service, which delegates to the
 * aggregate: the rules ("only an ONLINE driver may be claimed", "a driver cannot go off
 * duty mid-trip") stay in one place and cannot be bypassed by whoever calls second.
 */
@RestController
@RequestMapping("/api/v1/drivers/internal")
@Tag(name = "Drivers (internal)", description = "Called by trip-service; protected by X-Internal-Token")
public class InternalDriverController {

    private final DriverApplicationService driverService;

    public InternalDriverController(DriverApplicationService driverService) {
        this.driverService = driverService;
    }

    @PostMapping("/{driverId}/trip")
    @Operation(summary = "Claim a driver for a trip",
            description = "The driver becomes BUSY and stops being offered to anybody else. Refused with 409 "
                    + "when he is off duty or already has a trip, which is what lets the caller try the next "
                    + "candidate instead of failing the rider's request.")
    public InternalDriverDtos.DriverStateResponse assignTrip(
            @PathVariable String driverId,
            @Valid @RequestBody InternalDriverDtos.AssignTripRequest request) {
        return toState(driverService.assignTrip(driverId, request.tripId()));
    }

    @DeleteMapping("/{driverId}/trip")
    @Operation(summary = "Release a driver after a trip",
            description = "He returns to ONLINE — a driver who just finished a ride is by definition still "
                    + "working. Refused with 409 DRIVER_HAS_NO_TRIP when he has no active trip, which is how a "
                    + "retried call tells the caller that the desired state is already reached.")
    public InternalDriverDtos.DriverStateResponse finishTrip(@PathVariable String driverId) {
        return toState(driverService.finishTrip(driverId));
    }

    private static InternalDriverDtos.DriverStateResponse toState(Driver driver) {
        return new InternalDriverDtos.DriverStateResponse(
                driver.getId(),
                driver.getUserId(),
                driver.getDisplayName(),
                driver.getStatus().name(),
                driver.getCurrentTripId(),
                driver.isOnDuty(),
                driver.isAvailable(),
                driver.getCompletedTrips());
    }
}
