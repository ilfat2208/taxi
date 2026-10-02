package kz.taxi.common.kafka.consumer;

import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

/**
 * Deduplicating event handling for consumers.
 *
 * <p>Three things happen on every record, in this order, and every consumer in
 * the platform does them the same way:
 * <ol>
 *   <li>the correlation id from the record headers is restored, so a trace that
 *       started at an HTTP request continues through the Kafka hop;</li>
 *   <li>the {@code eventId} is claimed — a redelivery is logged and skipped;</li>
 *   <li>the handler runs inside the caller's transaction, and on failure the
 *       claim is released and the exception propagates, so Kafka retries and
 *       eventually routes the record to {@code <topic>.DLT}.</li>
 * </ol>
 */
@Component
@Slf4j
public class IdempotentEventHandler {

    private final EventEnvelopeCodec codec;
    private final ProcessedEventStore processedEventStore;

    public IdempotentEventHandler(EventEnvelopeCodec codec, ProcessedEventStore processedEventStore) {
        this.codec = codec;
        this.processedEventStore = processedEventStore;
    }

    public <P> void handleOnce(String consumerName,
                               ConsumerRecord<String, String> record,
                               Class<P> payloadType,
                               Consumer<EventEnvelope<P>> handler) {
        String correlationId = headerValue(record, EventEnvelopeCodec.HEADER_CORRELATION_ID);
        String previousMdc = MDC.get(CorrelationContext.MDC_KEY);
        try {
            if (correlationId != null) {
                CorrelationContext.set(correlationId);
                MDC.put(CorrelationContext.MDC_KEY, correlationId);
            }
            handleOnce(consumerName, record.value(), payloadType, handler);
        } finally {
            if (previousMdc == null) {
                MDC.remove(CorrelationContext.MDC_KEY);
                CorrelationContext.clear();
            } else {
                MDC.put(CorrelationContext.MDC_KEY, previousMdc);
                CorrelationContext.set(previousMdc);
            }
        }
    }

    public <P> void handleOnce(String consumerName,
                               String rawEvent,
                               Class<P> payloadType,
                               Consumer<EventEnvelope<P>> handler) {
        EventEnvelope<P> envelope = codec.decode(rawEvent, payloadType);

        if (!processedEventStore.claim(consumerName, envelope.eventId())) {
            log.info("skipping already processed event {} ({}) for consumer {}",
                    envelope.eventId(), envelope.eventType(), consumerName);
            return;
        }

        try {
            handler.accept(envelope);
        } catch (RuntimeException failure) {
            processedEventStore.release(consumerName, envelope.eventId());
            throw failure;
        }
    }

    private static String headerValue(ConsumerRecord<String, String> record, String headerName) {
        var header = record.headers() == null ? null : record.headers().lastHeader(headerName);
        return header == null || header.value() == null
                ? null
                : new String(header.value(), StandardCharsets.UTF_8);
    }
}
