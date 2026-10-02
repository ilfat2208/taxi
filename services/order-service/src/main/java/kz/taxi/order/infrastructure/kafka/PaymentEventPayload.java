package kz.taxi.order.infrastructure.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;

import java.time.Instant;

/**
 * The payload of {@code payment.completed} / {@code payment.failed}.
 *
 * <p>Deliberately a flat record with the fields this service needs to make a
 * decision, and tolerant of everything else: the payment service owns this shape,
 * it may add fields whenever it likes, and this consumer must not fail on a schema
 * it has not seen yet.
 *
 * <p>{@code orderId} is the field the whole reconciliation hangs on. When it is
 * missing the order is resolved from {@code paymentId} instead — a lookup, not a
 * guess.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PaymentEventPayload(String paymentId,
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

    /**
     * The outcome this event describes.
     *
     * <p>The event <em>type</em> is the authority when the payload's status is
     * missing or unrecognised: Kafka told us which fact happened, and a payload field
     * that disagrees is a bug on the producer side rather than a reason to leave a
     * paid order pending.
     */
    public PaymentOutcome toOutcome(String eventType) {
        PaymentStatus parsed = PaymentStatus.parse(status);
        PaymentStatus effective = parsed.isUnknown() ? statusOf(eventType) : parsed;
        // The fee and the total travel with the event: they are the payment service's
        // own numbers, and a consumer that re-derived them would be inventing money.
        return new PaymentOutcome(paymentId, paymentNumber, effective, amountMinor, feeMinor, totalMinor,
                currency, failureCode, failureReason);
    }

    private static PaymentStatus statusOf(String eventType) {
        if (KafkaTopics.Events.PAYMENT_COMPLETED.equals(eventType)) {
            return PaymentStatus.COMPLETED;
        }
        if (KafkaTopics.Events.PAYMENT_FAILED.equals(eventType)) {
            return PaymentStatus.FAILED;
        }
        return PaymentStatus.UNKNOWN;
    }
}
