package kz.taxi.payment.infrastructure;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import kz.taxi.common.core.money.Currency;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Wire shapes of the account service contract.
 *
 * <p>Kept as a copy instead of importing the account service's classes: the two
 * services are deployed separately, and a shared class would make a change in one
 * service a compile error in the other instead of a contract evolution. They are
 * matched field by field against {@code InternalAccountController} and
 * {@code AccountController} of account-service.
 */
final class AccountServiceDtos {

    private AccountServiceDtos() {
    }

    // ------------------------------------------------------------------ requests

    record PlaceHoldRequest(String accountId,
                            long amountMinor,
                            Currency currency,
                            String referenceType,
                            String referenceId,
                            String idempotencyKey,
                            String reason) {
    }

    record CaptureHoldRequest(String targetAccountId,
                              String referenceType,
                              String referenceId,
                              String operation,
                              String description) {
    }

    record ReleaseHoldRequest(String reason) {
    }

    record CreditRequest(String accountId,
                         long amountMinor,
                         Currency currency,
                         String referenceType,
                         String referenceId,
                         String operation,
                         String description) {
    }

    // ------------------------------------------------------------------ responses

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

    record CaptureHoldResponse(String holdId,
                               String status,
                               String transactionId,
                               String sourceAccountId,
                               String targetAccountId,
                               long amountMinor,
                               String currency,
                               boolean replayed) {
    }

    record CreditResponse(String accountId,
                          String transactionId,
                          long amountMinor,
                          String currency,
                          long balanceAfterMinor,
                          boolean replayed) {
    }

    record ResolveAccountResponse(String accountId,
                                  String ownerUserId,
                                  String currency,
                                  String status) {
    }

    /** Public account endpoint: the id field is named {@code id} there, not {@code accountId}. */
    record PublicAccountResponse(String id,
                                 String ownerUserId,
                                 String ownerPhone,
                                 String displayName,
                                 String type,
                                 String currency,
                                 String status,
                                 long balanceMinor,
                                 long heldMinor,
                                 long availableMinor,
                                 Instant createdAt,
                                 Instant updatedAt) {
    }

    /** RFC 7807 document as the platform produces it; unknown fields are ignored. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProblemDocument(String type,
                           String title,
                           Integer status,
                           String detail,
                           String code,
                           String instance,
                           String correlationId,
                           Instant timestamp,
                           Map<String, Object> details,
                           List<ProblemViolation> errors) {

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

    @JsonIgnoreProperties(ignoreUnknown = true)
    record ProblemViolation(String field, String message, Object rejectedValue) {
    }
}
