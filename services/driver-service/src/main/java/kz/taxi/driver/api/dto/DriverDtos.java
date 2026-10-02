package kz.taxi.driver.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import kz.taxi.driver.domain.DocumentKind;
import kz.taxi.driver.domain.DriverStatus;

import java.time.Instant;
import java.util.List;

/**
 * Request and response bodies of the driver API.
 *
 * <p>Records with validation annotations, and no domain types leaking into the
 * transport layer except the two enums a client must actually choose from.
 */
public final class DriverDtos {

    private DriverDtos() {
    }

    public record RegisterDriverRequest(
            @NotBlank @Size(max = 128) String displayName) {
    }

    /**
     * A driver submits a paper. {@code expiresAt} is required, because the whole
     * duty rule rests on it — a document without a date cannot be enforced.
     */
    public record DocumentRequest(
            @NotNull DocumentKind kind,
            @NotNull Instant expiresAt) {
    }

    /**
     * Duty toggle. Only {@code ONLINE} and {@code OFFLINE} are meaningful here:
     * {@code BUSY} is set by dispatch, and a client that could declare itself busy
     * would be able to hide from offers.
     */
    public record ChangeStatusRequest(
            @NotNull DriverStatus status) {
    }

    public record DocumentResponse(
            String documentId,
            String kind,
            Instant expiresAt,
            boolean valid) {
    }

    public record DriverResponse(
            String driverId,
            String userId,
            String phone,
            String displayName,
            String status,
            int ratingBp,
            int completedTrips,
            String currentTripId,
            boolean onDuty,
            boolean available,
            List<DocumentResponse> documents,
            Instant createdAt) {
    }
}
