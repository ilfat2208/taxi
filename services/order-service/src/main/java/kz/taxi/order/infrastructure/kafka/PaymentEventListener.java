package kz.taxi.order.infrastructure.kafka;

import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.consumer.IdempotentEventHandler;
import kz.taxi.order.application.CheckoutSagaService;
import kz.taxi.order.domain.OrderStatusHistory;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * The reconciliation path: it learns about a payment from Kafka.
 *
 * <p>Why both a synchronous answer and an event? Because the payment call can fail
 * <em>after</em> the money moved — a timeout, a 5xx, a redeploy mid-request. The
 * synchronous path then refuses to guess and leaves the order PENDING_PAYMENT; this
 * listener is what turns that unknown state into a decision.
 *
 * <p>Three guarantees come from the platform rather than from this class, and it
 * relies on all three:
 * <ul>
 *   <li>{@link IdempotentEventHandler} claims the {@code eventId} before the handler
 *       runs and releases it if the handler throws, which is what makes an
 *       at-least-once topic safe to consume;</li>
 *   <li>the correlation id of the original checkout is restored from the record
 *       headers, so one trace still explains the whole saga;</li>
 *   <li>a failure retries three times and then lands in {@code payment.events.DLT}
 *       instead of stalling the partition.</li>
 * </ul>
 *
 * <p>The handler itself is deliberately a dispatcher: all the reasoning lives in
 * {@link CheckoutSagaService}, where it can be tested without a broker.
 */
@Component
@Slf4j
public class PaymentEventListener {

    /** Consumer name of the dedup store: one entry per service, not per topic. */
    public static final String CONSUMER_NAME = "order-service";

    private final IdempotentEventHandler idempotentEventHandler;
    private final CheckoutSagaService checkoutSaga;

    public PaymentEventListener(IdempotentEventHandler idempotentEventHandler, CheckoutSagaService checkoutSaga) {
        this.idempotentEventHandler = idempotentEventHandler;
        this.checkoutSaga = checkoutSaga;
    }

    @KafkaListener(topics = KafkaTopics.PAYMENT_EVENTS,
            groupId = "${spring.kafka.consumer.group-id:order-service}")
    public void onPaymentEvent(ConsumerRecord<String, String> record) {
        idempotentEventHandler.handleOnce(CONSUMER_NAME, record, PaymentEventPayload.class, this::handle);
    }

    private void handle(EventEnvelope<PaymentEventPayload> envelope) {
        String eventType = envelope.eventType();
        if (!KafkaTopics.Events.PAYMENT_COMPLETED.equals(eventType)
                && !KafkaTopics.Events.PAYMENT_FAILED.equals(eventType)) {
            // Not our business: the topic carries the payment lifecycle, and this
            // service only reacts to how it ended.
            log.debug("ignoring event {} on {}", eventType, KafkaTopics.PAYMENT_EVENTS);
            return;
        }
        PaymentEventPayload payload = envelope.payload();
        // The merchant travels with the outcome: an order is paid per merchant, and an
        // event must settle the line it is actually about — a checkout whose answer was
        // lost has no payment id to match on, and the merchant is what is left.
        checkoutSaga.reconcilePayment(payload.orderId(), payload.merchantId(), payload.toOutcome(eventType),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);
    }
}
