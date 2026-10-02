package kz.taxi.order.infrastructure.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;

/**
 * Wire shapes of the payment service, as this service sees them.
 *
 * <p>{@code status} is intentionally a {@code String} and not an enum: the mapping
 * to {@link kz.taxi.order.domain.PaymentStatus} happens in one place, and a
 * status this service has never heard of becomes UNKNOWN instead of a
 * deserialization failure that would leave a paid order looking unpaid.
 */
public final class PaymentDtos {

    private PaymentDtos() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record MerchantPaymentRequest(String sourceAccountId,
                                         String merchantId,
                                         long amountMinor,
                                         String currency,
                                         String description,
                                         String orderId) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PaymentResponse(String paymentId,
                                  String paymentNumber,
                                  String type,
                                  String status,
                                  String ownerUserId,
                                  long amountMinor,
                                  long feeMinor,
                                  long totalMinor,
                                  String currency,
                                  String sourceAccountId,
                                  String targetAccountId,
                                  String merchantId,
                                  String orderId,
                                  String failureCode,
                                  String failureReason,
                                  Instant createdAt,
                                  Instant completedAt) {
    }

    /**
     * Body of a refund request.
     *
     * <p>Only the reason is sent: the payment already knows how much it moved, and
     * letting the caller restate the amount invites a mismatch between the two.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RefundRequest(String reason) {
    }
}
