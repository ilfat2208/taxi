package kz.taxi.common.core.event;

import com.fasterxml.jackson.annotation.JsonInclude;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.id.Ulid;

import java.time.Instant;

/**
 * Transport envelope for every domain event published to Kafka.
 *
 * <p>The envelope is intentionally separate from the payload: routing metadata
 * (type, aggregate, version, tracing ids) is stable, while payloads evolve.
 * Consumers reject envelopes with an unknown {@code eventType} instead of
 * guessing, and {@code aggregateVersion} gives them optimistic-concurrency
 * ordering per aggregate.
 *
 * @param eventId         unique id of this event (also the consumer dedup key)
 * @param eventType       stable name, e.g. {@code payment.completed}
 * @param aggregateType   e.g. {@code Payment}
 * @param aggregateId     id of the aggregate that changed (used as Kafka key -> per-aggregate ordering)
 * @param aggregateVersion monotonically increasing version within the aggregate
 * @param occurredAt      when the business fact happened (not when it was published)
 * @param correlationId   ties the event back to the originating request
 * @param causationId     id of the command/event that caused this one (saga tracing)
 * @param payload         event-specific body
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record EventEnvelope<T>(
        String eventId,
        String eventType,
        String aggregateType,
        String aggregateId,
        long aggregateVersion,
        Instant occurredAt,
        String correlationId,
        String causationId,
        T payload
) {

    /** Builds an envelope, inheriting the correlation id of the current thread. */
    public static <T> EventEnvelope<T> of(String eventType,
                                          String aggregateType,
                                          String aggregateId,
                                          long aggregateVersion,
                                          T payload) {
        return new EventEnvelope<>(
                Ulid.nextId(),
                eventType,
                aggregateType,
                aggregateId,
                aggregateVersion,
                Instant.now(),
                CorrelationContext.getOrCreate(),
                null,
                payload);
    }

    public EventEnvelope<T> causedBy(String causationId) {
        return new EventEnvelope<>(eventId, eventType, aggregateType, aggregateId, aggregateVersion,
                occurredAt, correlationId, causationId, payload);
    }

    /** Kafka record key: guarantees ordering within one aggregate. */
    public String partitionKey() {
        return aggregateId;
    }
}
