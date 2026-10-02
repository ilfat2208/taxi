package kz.taxi.dispatch.api;

import kz.taxi.dispatch.api.dto.DispatchDtos;
import kz.taxi.dispatch.application.FleetService;
import kz.taxi.dispatch.application.LocationIngestService;
import org.springframework.stereotype.Component;

/**
 * Application to transport mapping.
 *
 * <p>Trivial today, and kept anyway: this is the file that will answer "why does
 * the map show this field" when somebody asks, and the place where an internal
 * detail accidentally added to a view record stops before it reaches clients.
 */
@Component
public class DispatchMapper {

    public DispatchDtos.IngestResponse toResponse(LocationIngestService.IngestResult result) {
        return new DispatchDtos.IngestResponse(result.driverId(), result.accepted(), result.recordedAt());
    }

    public DispatchDtos.FleetResponse toResponse(FleetService.FleetView view) {
        return new DispatchDtos.FleetResponse(
                view.generatedAt(),
                view.staleAfterSeconds(),
                view.onDuty(),
                view.withPosition(),
                view.drivers().stream().map(this::toResponse).toList());
    }

    public DispatchDtos.DriverResponse toResponse(FleetService.DriverView driver) {
        return new DispatchDtos.DriverResponse(
                driver.driverId(),
                driver.displayName(),
                driver.phone(),
                driver.status(),
                driver.lat(),
                driver.lon(),
                driver.headingDeg(),
                driver.speedKph(),
                driver.ageSeconds(),
                driver.stale());
    }

    public DispatchDtos.NearestResponse toResponse(FleetService.CandidateList list) {
        return new DispatchDtos.NearestResponse(
                list.generatedAt(),
                list.radiusM(),
                list.candidates().stream().map(this::toResponse).toList());
    }

    public DispatchDtos.CandidateResponse toResponse(FleetService.Candidate candidate) {
        return new DispatchDtos.CandidateResponse(
                candidate.driverId(),
                candidate.displayName(),
                candidate.distanceM(),
                candidate.lat(),
                candidate.lon(),
                candidate.ageSeconds());
    }
}
