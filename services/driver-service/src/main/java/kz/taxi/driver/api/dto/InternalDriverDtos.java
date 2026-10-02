package kz.taxi.driver.api.dto;

/**
 * Contract used by other services through the {@code /internal/} endpoints.
 *
 * <p>Deliberately smaller than {@link DriverDtos.DriverResponse}: a workload that claims
 * a driver for a trip needs his identity, his duty state and the trip he is on — not his
 * phone number, not his documents, and not a list of them. An internal contract that
 * returned everything would be a contract that every caller has to be trusted with.
 */
public final class InternalDriverDtos {

    private InternalDriverDtos() {
    }

    /** The trip a driver is being claimed for. */
    public record AssignTripRequest(
            @jakarta.validation.constraints.NotBlank(message = "tripId is required") String tripId) {
    }

    /**
     * The state of a driver after a claim or a release.
     *
     * <p>{@code driverId} is mandatory and {@code status} is the aggregate's own name for
     * the duty state, so a caller never has to derive "is he free" from a combination of
     * fields — {@code available} answers exactly that.
     */
    public record DriverStateResponse(
            String driverId,
            String userId,
            String displayName,
            String status,
            String currentTripId,
            boolean onDuty,
            boolean available,
            int completedTrips) {
    }
}
