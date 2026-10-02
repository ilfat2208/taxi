package kz.taxi.account.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import kz.taxi.account.domain.LedgerOperation;
import kz.taxi.common.core.money.Currency;

import java.time.Instant;

/**
 * Contract used by other services (currently payment-service) through the
 * {@code /internal/} endpoints.
 *
 * <p>These endpoints move money, so every request carries an idempotency key or a
 * business reference: the caller is a saga that may be retried after a crash, and
 * "retry" must never mean "charge twice".
 */
public final class InternalAccountDtos {

    private InternalAccountDtos() {
    }

    public record PlaceHoldRequest(
            @NotBlank(message = "accountId is required") String accountId,
            @Positive(message = "amountMinor must be positive") long amountMinor,
            @NotNull(message = "currency is required") Currency currency,
            @NotBlank(message = "referenceType is required") String referenceType,
            @NotBlank(message = "referenceId is required") String referenceId,
            @NotBlank(message = "idempotencyKey is required") String idempotencyKey,
            String reason) {
    }

    public record HoldResponse(
            String holdId,
            String accountId,
            long amountMinor,
            String currency,
            String status,
            long availableMinor,
            Instant createdAt,
            Instant expiresAt,
            boolean replayed) {
    }

    public record CaptureHoldRequest(
            String targetAccountId,
            @NotBlank(message = "referenceType is required") String referenceType,
            @NotBlank(message = "referenceId is required") String referenceId,
            LedgerOperation operation,
            String description) {
    }

    public record CaptureHoldResponse(
            String holdId,
            String status,
            String transactionId,
            String sourceAccountId,
            String targetAccountId,
            long amountMinor,
            String currency,
            boolean replayed) {
    }

    public record ReleaseHoldRequest(String reason) {
    }

    public record CreditRequest(
            @NotBlank(message = "accountId is required") String accountId,
            @Positive(message = "amountMinor must be positive") long amountMinor,
            @NotNull(message = "currency is required") Currency currency,
            @NotBlank(message = "referenceType is required") String referenceType,
            @NotBlank(message = "referenceId is required") String referenceId,
            LedgerOperation operation,
            String description) {
    }

    public record CreditResponse(
            String accountId,
            String transactionId,
            long amountMinor,
            String currency,
            long balanceAfterMinor,
            boolean replayed) {
    }

    public record ResolveAccountResponse(
            String accountId,
            String ownerUserId,
            String currency,
            String status) {
    }

    public record InternalAccountView(
            String accountId,
            String ownerUserId,
            String ownerPhone,
            String currency,
            String status,
            long balanceMinor,
            long heldMinor,
            long availableMinor) {
    }
}
