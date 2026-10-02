package kz.taxi.common.kafka.consumer;

import java.util.Optional;

/**
 * Remembers which events a consumer has already processed.
 *
 * <p>Kafka gives at-least-once delivery, so a consumer <em>will</em> see the same
 * record twice (rebalance, retry after a transient failure, relay restart).
 * "Charge the customer" is not something you want to discover twice, so every
 * consumer claims the {@code eventId} before acting on it.
 *
 * <p>The claim is released when the handler throws: the event must stay
 * retryable, and a store that silently swallows failures would turn a transient
 * database blip into a permanently lost payment event.
 */
public interface ProcessedEventStore {

    /** Atomically records the event as processed; {@code false} means "seen before". */
    boolean claim(String consumerName, String eventId);

    /** Frees a claim after a failed handler so the record can be retried. */
    void release(String consumerName, String eventId);

    boolean isProcessed(String consumerName, String eventId);

    Optional<java.time.Instant> processedAt(String consumerName, String eventId);
}
