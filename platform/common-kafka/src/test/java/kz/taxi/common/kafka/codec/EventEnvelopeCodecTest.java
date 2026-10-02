package kz.taxi.common.kafka.codec;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.kafka.support.TestJson;
import kz.taxi.common.core.event.EventEnvelope;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class EventEnvelopeCodecTest {

    public record PaymentCompleted(String paymentId, long amountMinor, String currency) {
    }

    private final EventEnvelopeCodec codec = new EventEnvelopeCodec(TestJson.mapper());

    @Test
    @DisplayName("round-trips an envelope with its payload type")
    void round_trips() {
        EventEnvelope<PaymentCompleted> envelope = EventEnvelope.of(
                "payment.completed", "Payment", "P-1", 7L,
                new PaymentCompleted("P-1", 150_000, "KZT"));

        String json = codec.encode(envelope);
        EventEnvelope<PaymentCompleted> decoded = codec.decode(json, PaymentCompleted.class);

        assertThat(decoded.eventId()).isEqualTo(envelope.eventId());
        assertThat(decoded.eventType()).isEqualTo("payment.completed");
        assertThat(decoded.aggregateVersion()).isEqualTo(7L);
        assertThat(decoded.occurredAt()).isEqualTo(envelope.occurredAt());
        assertThat(decoded.payload()).isEqualTo(new PaymentCompleted("P-1", 150_000, "KZT"));
    }

    @Test
    @DisplayName("tolerates unknown payload fields so producers can evolve first")
    void tolerates_unknown_fields() {
        String json = """
                {"eventId":"01J8ZCQ7Y4R3F0N5G8K2M9QW1T","eventType":"payment.completed","aggregateType":"Payment",
                 "aggregateId":"P-1","aggregateVersion":1,"occurredAt":"2024-09-01T10:15:30Z","correlationId":"c-1",
                 "payload":{"paymentId":"P-1","amountMinor":100,"currency":"KZT","brandNewField":"ignored"}}
                """;

        EventEnvelope<PaymentCompleted> decoded = codec.decode(json, PaymentCompleted.class);

        assertThat(decoded.payload().paymentId()).isEqualTo("P-1");
        assertThat(decoded.correlationId()).isEqualTo("c-1");
    }

    @Test
    @DisplayName("carries routing metadata as record headers")
    void exposes_headers() {
        EventEnvelope<PaymentCompleted> envelope = EventEnvelope.of(
                "payment.completed", "Payment", "P-1", 1L, new PaymentCompleted("P-1", 1, "KZT"))
                .causedBy("cmd-9");

        Map<String, String> headers = codec.headers(envelope);

        assertThat(headers)
                .containsEntry(EventEnvelopeCodec.HEADER_EVENT_TYPE, "payment.completed")
                .containsEntry(EventEnvelopeCodec.HEADER_AGGREGATE_ID, "P-1")
                .containsEntry(EventEnvelopeCodec.HEADER_CAUSATION_ID, "cmd-9")
                .containsKey(EventEnvelopeCodec.HEADER_CORRELATION_ID);
        assertThat(codec.decodeHeaders(codec.encodeHeaders(envelope))).isEqualTo(headers);
    }

    @Test
    @DisplayName("reads metadata without binding a payload type")
    void decodes_metadata_only() {
        EventEnvelope<PaymentCompleted> envelope =
                EventEnvelope.of("order.paid", "Order", "O-1", 2L, new PaymentCompleted("P-1", 5, "KZT"));

        assertThat(codec.eventTypeOf(codec.encode(envelope))).isEqualTo("order.paid");
        assertThat(codec.decodeToTree(codec.encode(envelope)).payload().path("currency").asText()).isEqualTo("KZT");
    }

    @Test
    @DisplayName("fails loudly on a malformed record instead of silently dropping it")
    void fails_on_malformed_payload() {
        assertThatThrownBy(() -> codec.decode("{not json", PaymentCompleted.class))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("malformed event envelope");

        assertThat(codec.eventTypeOf("{not json")).isNull();
        assertThat(codec.decodeHeaders("{not json")).isEmpty();
        assertThat(codec.decodeHeaders(null)).isEmpty();
    }
}

