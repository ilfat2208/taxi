package kz.taxi.payment.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import kz.taxi.common.core.money.Currency;

import java.time.Instant;
import java.util.List;

/**
 * Request and response bodies of the payment API.
 *
 * <p>Nested records rather than a file per DTO: the shapes are small and only
 * meaningful together, and the whole public contract of the service can be read in
 * one place. Amounts are always minor units, ids are always strings — the API never
 * exposes an entity or a {@code Page}.
 */
public final class PaymentDtos {

    private PaymentDtos() {
    }

    // ------------------------------------------------------------------ requests

    public record TransferRequest(
            @NotBlank(message = "sourceAccountId is required") String sourceAccountId,
            String targetPhone,
            String targetAccountId,
            @Positive(message = "amountMinor must be positive") long amountMinor,
            @NotNull(message = "currency is required") Currency currency,
            String description) {
    }

    public record MerchantPaymentRequest(
            @NotBlank(message = "sourceAccountId is required") String sourceAccountId,
            @NotBlank(message = "merchantId is required") String merchantId,
            @Positive(message = "amountMinor must be positive") long amountMinor,
            @NotNull(message = "currency is required") Currency currency,
            String description,
            @NotBlank(message = "orderId is required") String orderId) {
    }

    /** {@code amountMinor} is nullable on purpose: null means "refund everything still refundable". */
    public record RefundRequest(Long amountMinor, String reason) {
    }

    // ------------------------------------------------------------------ responses

    /**
     * One payment.
     *
     * <p>{@code amountMinor} is what the recipient gets, {@code feeMinor} what the
     * platform charged and {@code totalMinor} what left the payer's account; the
     * three always satisfy {@code total = amount + fee}.
     *
     * <p>The id field is called {@code paymentId} rather than {@code id} so that it
     * matches the event payload and the platform's other money responses
     * ({@code holdId}, {@code transactionId}, {@code refundId}): a consumer that
     * reads an event and a response with the same parser should not need two field
     * names for one id.
     */
    public record PaymentResponse(
            String paymentId,
            String paymentNumber,
            String type,
            String status,
            String ownerUserId,
            String sourceAccountId,
            String targetAccountId,
            String merchantId,
            String orderId,
            long amountMinor,
            long feeMinor,
            long totalMinor,
            String currency,
            String description,
            String failureCode,
            String failureReason,
            Instant createdAt,
            Instant updatedAt,
            Instant completedAt) {
    }

    public record PaymentTransitionResponse(
            String id,
            String fromStatus,
            String toStatus,
            String reason,
            String actor,
            Instant createdAt) {
    }

    /** A payment with its full history: what {@code GET /payments/{id}} returns. */
    public record PaymentDetailsResponse(PaymentResponse payment, List<PaymentTransitionResponse> transitions) {
    }

    public record RefundResponse(
            String refundId,
            String paymentId,
            long amountMinor,
            String currency,
            String status,
            String reason,
            Instant createdAt,
            Instant updatedAt) {
    }
}
