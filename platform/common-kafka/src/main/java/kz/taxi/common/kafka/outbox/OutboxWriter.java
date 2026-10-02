package kz.taxi.common.kafka.outbox;

import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Appends a domain event to the outbox — inside the caller's transaction.
 *
 * <p>The invariant this class exists to protect: an event and the state change
 * it announces are committed or rolled back together.
 *
 * <pre>{@code
 * @Transactional
 * public void transfer(Command cmd) {
 *     Payment payment = paymentRepository.save(Payment.complete(cmd));
 *     outbox.append(KafkaTopics.PAYMENT_EVENTS, EventEnvelope.of(
 *             KafkaTopics.Events.PAYMENT_COMPLETED, "Payment", payment.getId(), payment.getVersion(),
 *             PaymentCompletedPayload.from(payment)));
 * }   // <- single commit: either both rows land, or neither does
 * }</pre>
 */
@Component
@Slf4j
public class OutboxWriter {

    private final OutboxRepository repository;
    private final EventEnvelopeCodec codec;

    public OutboxWriter(OutboxRepository repository, EventEnvelopeCodec codec) {
        this.repository = repository;
        this.codec = codec;
    }

    public void append(String topic, EventEnvelope<?> envelope) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            // Not fatal, but it means the event is not guaranteed to be atomic with
            // the state change — exactly the hole the outbox exists to close.
            log.warn("appending event {} outside a transaction; outbox atomicity is not guaranteed",
                    envelope.eventType());
        }
        OutboxMessage message = new OutboxMessage(
                envelope.eventId(),
                topic,
                envelope.eventType(),
                envelope.aggregateType(),
                envelope.aggregateId(),
                envelope.partitionKey(),
                codec.encode(envelope),
                codec.encodeHeaders(envelope));
        repository.save(message);
        log.debug("queued event {} for aggregate {} on topic {}",
                envelope.eventType(), envelope.aggregateId(), topic);
    }

    /** Convenience for the common case: build the envelope and queue it in one call. */
    public <T> void append(String topic,
                           String eventType,
                           String aggregateType,
                           String aggregateId,
                           long aggregateVersion,
                           T payload) {
        append(topic, EventEnvelope.of(eventType, aggregateType, aggregateId, aggregateVersion, payload));
    }
}
