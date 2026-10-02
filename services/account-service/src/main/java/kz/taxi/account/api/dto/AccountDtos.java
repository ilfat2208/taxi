package kz.taxi.account.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.common.core.money.Currency;

import java.time.Instant;
import java.util.List;

/**
 * Request and response bodies of the account API.
 *
 * <p>Grouped as nested records rather than one file per DTO: the shapes are tiny
 * and only meaningful together, and a reader can see the whole public contract of
 * the service in one place.
 */
public final class AccountDtos {

    private AccountDtos() {
    }

    public record CreateAccountRequest(
            @NotNull(message = "currency is required") Currency currency,
            @NotNull(message = "type is required") AccountType type,
            String displayName) {
    }

    public record AccountResponse(
            String id,
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

    public record LedgerEntryResponse(
            String id,
            String transactionId,
            String accountId,
            String direction,
            long amountMinor,
            String currency,
            long balanceAfterMinor,
            String operation,
            String referenceType,
            String referenceId,
            String description,
            Instant createdAt) {
    }

    public record TopUpRequest(
            @Positive(message = "amountMinor must be positive") long amountMinor,
            @NotBlank(message = "reason is required") String reason) {
    }

    public record HoldView(
            String holdId,
            String accountId,
            long amountMinor,
            String currency,
            String status,
            String referenceType,
            String referenceId,
            String reason,
            Instant expiresAt,
            Instant createdAt) {
    }

    /**
     * Sets or changes one window's outgoing limit.
     *
     * <p>No currency field: it is taken from the account. Letting a client send one
     * would allow a limit expressed in the wrong currency, which is silently off by
     * a factor of 100 or 470 depending on the pair.
     *
     * <p>{@code outgoingLimitMinor} must be positive — a zero limit is not "no
     * spending", it is an unexplained freeze, and freezing an account is a separate
     * operation with its own audit trail.
     */
    public record SetLimitRequest(
            @NotNull(message = "window is required (DAILY or MONTHLY)") LimitWindow window,
            @Positive(message = "outgoingLimitMinor must be positive") long outgoingLimitMinor) {
    }

    /**
     * One window: the ceiling, what is already committed against it, and when it resets.
     *
     * <p>{@code configured=false} means no limit exists, i.e. unlimited — the
     * documented default — and the amount fields are null rather than 0, because
     * "no limit" and "a limit of zero" are very different messages to show a customer.
     */
    public record LimitView(
            String window,
            boolean configured,
            Long outgoingLimitMinor,
            long usedMinor,
            Long remainingMinor,
            Instant windowStart,
            Instant windowEnd,
            Instant updatedAt) {
    }

    /** The velocity control: how many outgoing operations are allowed per short window. */
    public record VelocityView(
            boolean enabled,
            int maxOperations,
            String window,
            long operationsInWindow) {
    }

    public record LimitsResponse(
            String accountId,
            String currency,
            List<LimitView> limits,
            VelocityView velocity) {
    }
}
