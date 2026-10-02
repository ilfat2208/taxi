package kz.taxi.dispatch.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.dispatch.api.dto.DispatchDtos;
import kz.taxi.dispatch.application.DispatchAccess;
import kz.taxi.dispatch.application.LocationIngestService;
import kz.taxi.dispatch.domain.DriverPosition;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Where driver apps report positions.
 *
 * <p>Two endpoints, one rule: the caller must be a driver on duty. The single-point
 * form exists because the common case is one reading every few seconds; the batch
 * form exists because phones lose signal in tunnels and underpasses, and a burst
 * that arrives late must be accepted — with the real reading times, so a stale
 * replay cannot masquerade as a fresh position.
 */
@RestController
@RequestMapping("/api/v1/locations")
@Tag(name = "Locations", description = "Driver position reporting")
public class LocationController {

    private final LocationIngestService ingestService;
    private final DispatchMapper mapper;
    private final CurrentUser currentUser;

    public LocationController(LocationIngestService ingestService,
                              DispatchMapper mapper,
                              CurrentUser currentUser) {
        this.ingestService = ingestService;
        this.mapper = mapper;
        this.currentUser = currentUser;
    }

    @PostMapping
    @Operation(summary = "Report the current position of the calling driver")
    public DispatchDtos.IngestResponse record(@Valid @RequestBody DispatchDtos.PositionRequest request) {
        AuthenticatedUser user = currentUser.require();
        DispatchAccess.requireDriver(user);
        return mapper.toResponse(ingestService.record(user.userId(), List.of(toPosition(request))));
    }

    @PostMapping("/batch")
    @Operation(summary = "Report positions collected while the app was offline")
    public DispatchDtos.IngestResponse recordBatch(@Valid @RequestBody DispatchDtos.PositionBatchRequest request) {
        AuthenticatedUser user = currentUser.require();
        DispatchAccess.requireDriver(user);
        List<DriverPosition> points = request.points().stream().map(LocationController::toPosition).toList();
        return mapper.toResponse(ingestService.record(user.userId(), points));
    }

    private static DriverPosition toPosition(DispatchDtos.PositionRequest request) {
        return DriverPosition.of(request.lat(), request.lon(), request.headingDeg(),
                request.speedKph(), request.accuracyM(), request.at());
    }
}
