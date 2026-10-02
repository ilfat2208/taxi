package kz.taxi.trip.infrastructure.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Wire shapes of the three services this one talks to.
 *
 * <p>Copied rather than imported from their modules, for the reason the platform
 * states for every cross-service contract: the services deploy independently, and a
 * shared class would turn a field rename in one of them into a compile error in the
 * other instead of a contract change with a version. They are matched field by field
 * against {@code InternalAccountController}, {@code InternalAccountDtos} of
 * account-service, {@code InternalDispatchController} of dispatch-service and the
 * internal driver endpoints of driver-service.
 *
 * <p>Every response type ignores unknown fields: a service that adds a field must not
 * break the one that has not been rebuilt yet.
 */
final class ClientDtos {

    private ClientDtos() {
    }

    // ------------------------------------------------------------------ account-service

    record PlaceHoldRequest(String accountId,
                            long amountMinor,
                            String currency,
                            String referenceType,
                            String referenceId,
                            String idempotencyKey,
                            String reason) {
    }

    record ReleaseHoldRequest(String reason) {
    }

    record CaptureHoldRequest(String targetAccountId,
                              String referenceType,
                              String referenceId,
                              String operation,
                              String description) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record HoldResponse(String holdId,
                        String accountId,
                        long amountMinor,
                        String currency,
                        String status,
                        long availableMinor,
                        Instant createdAt,
                        Instant expiresAt,
                        boolean replayed) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record CaptureHoldResponse(String holdId,
                               String status,
                               String transactionId,
                               String sourceAccountId,
                               String targetAccountId,
                               long amountMinor,
                               String currency,
                               boolean replayed) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ResolveAccountResponse(String accountId,
                                  String ownerUserId,
                                  String currency,
                                  String status) {
    }

    // ------------------------------------------------------------------ dispatch-service

    @JsonIgnoreProperties(ignoreUnknown = true)
    record CandidateResponse(String driverId,
                             String displayName,
                             double distanceM,
                             double lat,
                             double lon,
                             long ageSeconds) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record NearestResponse(Instant generatedAt,
                           int radiusM,
                           List<CandidateResponse> candidates) {
    }

    // ------------------------------------------------------------------ driver-service

    record AssignDriverTripRequest(String tripId) {
    }

    /**
     * The driver-service answer to a claim or a release.
     *
     * <p>Matches {@code InternalDriverDtos.DriverStateResponse}: identity, duty state and
     * the trip he is on — not his documents and not his phone, which a workload that
     * claims a car has no business reading.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record DriverResponse(String driverId,
                          String userId,
                          String displayName,
                          String status,
                          String currentTripId,
                          boolean onDuty,
                          boolean available,
                          int completedTrips) {
    }

    // ------------------------------------------------------------------ errors

    /** RFC 7807 document as the platform produces it; only the code and the text are read. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProblemDocument(String type,
                           String title,
                           Integer status,
                           String detail,
                           String code,
                           String instance,
                           String correlationId,
                           Map<String, Object> details) {

        String bestMessage() {
            if (detail != null && !detail.isBlank()) {
                return detail;
            }
            if (title != null && !title.isBlank()) {
                return title;
            }
            return code;
        }
    }
}
