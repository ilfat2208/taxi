package kz.taxi.common.kafka.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.kafka.support.TestJson;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IdempotentEventHandlerTest {

    public record OrderPaid(String orderId, long amountMinor) {
    }

    private EventEnvelopeCodec codec;
    private InMemoryProcessedEventStore store;
    private IdempotentEventHandler handler;

    @BeforeEach
    void setUp() {
        codec = new EventEnvelopeCodec(TestJson.mapper());
        store = new InMemoryProcessedEventStore(Duration.ofHours(1));
        handler = new IdempotentEventHandler(codec, store);
    }

    private ConsumerRecord<String, String> record(EventEnvelope<OrderPaid> envelope) {
        ConsumerRecord<String, String> record =
                new ConsumerRecord<>("order.events", 0, 0L, envelope.aggregateId(), codec.encode(envelope));
        codec.headers(envelope).forEach((key, value) ->
                record.headers().add(new RecordHeader(key, value.getBytes(StandardCharsets.UTF_8))));
        return record;
    }

    @Test
    @DisplayName("processes a redelivered event exactly once")
    void deduplicates_redelivery() {
        EventEnvelope<OrderPaid> envelope =
                EventEnvelope.of("order.paid", "Order", "O-1", 1L, new OrderPaid("O-1", 5_000));
        ConsumerRecord<String, String> record = record(envelope);
        List<String> handled = new ArrayList<>();

        handler.handleOnce("order-service", record, OrderPaid.class, event -> handled.add(event.payload().orderId()));
        handler.handleOnce("order-service", record, OrderPaid.class, event -> handled.add(event.payload().orderId()));
        handler.handleOnce("order-service", record, OrderPaid.class, event -> handled.add(event.payload().orderId()));

        assertThat(handled).containsExactly("O-1");
        assertThat(store.isProcessed("order-service", envelope.eventId())).isTrue();
    }

    @Test
    @DisplayName("treats the same event delivered to another consumer as new")
    void isolates_consumers() {
        EventEnvelope<OrderPaid> envelope =
                EventEnvelope.of("order.paid", "Order", "O-1", 1L, new OrderPaid("O-1", 5_000));
        ConsumerRecord<String, String> record = record(envelope);
        List<String> handled = new ArrayList<>();

        handler.handleOnce("order-service", record, OrderPaid.class, event -> handled.add("order"));
        handler.handleOnce("analytics-service", record, OrderPaid.class, event -> handled.add("analytics"));

        assertThat(handled).containsExactly("order", "analytics");
    }

    @Test
    @DisplayName("releases the claim when the handler fails so Kafka can retry")
    void releases_claim_on_failure() {
        EventEnvelope<OrderPaid> envelope =
                EventEnvelope.of("order.paid", "Order", "O-1", 1L, new OrderPaid("O-1", 5_000));
        ConsumerRecord<String, String> record = record(envelope);

        assertThatThrownBy(() -> handler.handleOnce("order-service", record, OrderPaid.class, event -> {
            throw new IllegalStateException("database is down");
        })).isInstanceOf(IllegalStateException.class);

        assertThat(store.isProcessed("order-service", envelope.eventId())).isFalse();

        List<String> handled = new ArrayList<>();
        handler.handleOnce("order-service", record, OrderPaid.class, event -> handled.add(event.payload().orderId()));
        assertThat(handled).containsExactly("O-1");
    }

    @Test
    @DisplayName("restores the correlation id for the duration of the handler")
    void restores_correlation_context() {
        EventEnvelope<OrderPaid> envelope = EventEnvelope.of("order.paid", "Order", "O-1", 1L,
                new OrderPaid("O-1", 1)).causedBy("cmd-1");
        ConsumerRecord<String, String> record = record(envelope);
        String[] seen = new String[1];

        handler.handleOnce("order-service", record, OrderPaid.class, event -> seen[0] = CorrelationContext.get());

        assertThat(seen[0]).isEqualTo(envelope.correlationId());
        assertThat(CorrelationContext.get()).isNull();
    }
}

