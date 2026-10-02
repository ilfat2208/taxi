package kz.taxi.payment.application;

import kz.taxi.payment.domain.Payment;

import java.time.Instant;

/**
 * Payload of the events this service publishes to {@code payment.events}.
 *
 * <p>Flat, self-contained and in minor units: a consumer — order-service waiting
 * for {@code payment.completed}, a reconciliation job reading the whole topic —
 * must be able to react without calling back into this service. That call would
 * re-introduce the coupling Kafka exists to remove.
 *
 * <p>The same shape is used for all four event types, with {@code status} and
 * {@code failureCode} carrying the difference. One payload means one consumer-side
 * parser and one place where a new field has to be considered, and it keeps the
 * topic's schema stable enough for JSON schema evolution to be boring.
 *
 * <p>The field names match the payment API's {@code PaymentResponse} on purpose: a
 * consumer that reads an event and then re-reads the payment (order-service does
 * exactly that) parses one shape, not two.
 */
public final class PaymentEvents {

    private PaymentEvents() {
    }

    public record PaymentEvent(
            String paymentId,
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
            Instant completedAt,
            Instant occurredAt) {

        public static PaymentEvent of(Payment payment) {
            return new PaymentEvent(
                    payment.getId(),
                    payment.getPaymentNumber(),
                    payment.getType().name(),
                    payment.getStatus().name(),
                    payment.getOwnerUserId(),
                    payment.getAmountMinor(),
                    payment.getFeeMinor(),
                    payment.getTotalMinor(),
                    payment.getCurrency().name(),
                    payment.getSourceAccountId(),
                    payment.getTargetAccountId(),
                    payment.getMerchantId(),
                    payment.getOrderId(),
                    payment.getFailureCode(),
                    payment.getFailureReason(),
                    payment.getCreatedAt(),
                    payment.getCompletedAt(),
                    // When the fact happened (this event), which is not the same as when
                    // the payment was created or completed: a payment completed by the
                    // recovery job announces a fact that is minutes old.
                    Instant.now());
        }
    }
}
