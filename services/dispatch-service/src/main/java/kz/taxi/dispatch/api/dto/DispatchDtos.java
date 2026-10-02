package kz.taxi.dispatch.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * Request and response bodies of the dispatch API.
 *
 * <p>{@code at} is optional on input and defaults to "now": a driver app that
 * queues points while offline sends the real reading time, and one reporting
 * live omits it. Everything the fleet map returns is a number or an ISO instant —
 * no formatted strings, because formatting belongs to the client.
 */
public final class DispatchDtos {

    private DispatchDtos() {
    }

    public record PositionRequest(
            @NotNull Double lat,
            @NotNull Double lon,
            Double headingDeg,
            Double speedKph,
            Double accuracyM,
            Instant at) {
    }

    /**
     * A batch of readings. {@code @Size} here is only a first guard against an
     * absurd request body; the real limit is configuration
     * ({@code taxi.dispatch.max-batch-size}) and is enforced with a proper error code.
     */
    public record PositionBatchRequest(
            @NotEmpty @Size(max = 500) List<@Valid PositionRequest> points) {
    }

    public record IngestResponse(String driverId, int accepted, Instant recordedAt) {
    }

    public record DriverResponse(
            String driverId,
            String displayName,
            String phone,
            String status,
            double lat,
            double lon,
            double headingDeg,
            double speedKph,
            long ageSeconds,
            boolean stale) {
    }

    public record FleetResponse(
            Instant generatedAt,
            long staleAfterSeconds,
            int onDuty,
            int withPosition,
            List<DriverResponse> drivers) {
    }

    public record CandidateResponse(
            String driverId,
            String displayName,
            double distanceM,
            double lat,
            double lon,
            long ageSeconds) {
    }

    public record NearestResponse(
            Instant generatedAt,
            int radiusM,
            List<CandidateResponse> candidates) {
    }
}
