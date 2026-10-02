package kz.taxi.common.core.event;

import kz.taxi.common.core.context.CorrelationContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class EventEnvelopeTest {

    @AfterEach
    void tearDown() {
        CorrelationContext.clear();
    }

    @Test
    @DisplayName("derives id, timestamp and correlation from the current thread")
    void builds_from_context() {
        CorrelationContext.set("corr-123");

        EventEnvelope<Map<String, Object>> envelope =
                EventEnvelope.of("payment.completed", "Payment", "P-1", 3L, Map.of("amount", 1000));

        assertThat(envelope.eventId()).hasSize(26);
        assertThat(envelope.eventType()).isEqualTo("payment.completed");
        assertThat(envelope.aggregateType()).isEqualTo("Payment");
        assertThat(envelope.aggregateId()).isEqualTo("P-1");
        assertThat(envelope.aggregateVersion()).isEqualTo(3L);
        assertThat(envelope.correlationId()).isEqualTo("corr-123");
        assertThat(envelope.occurredAt()).isNotNull();
        assertThat(envelope.payload()).containsEntry("amount", 1000);
    }

    @Test
    @DisplayName("mints a correlation id when the thread has none")
    void mints_correlation_when_absent() {
        EventEnvelope<String> envelope = EventEnvelope.of("order.created", "Order", "O-1", 1L, "body");

        assertThat(envelope.correlationId()).hasSize(26);
        assertThat(envelope.causedBy("cmd-1").causationId()).isEqualTo("cmd-1");
        assertThat(envelope.partitionKey()).isEqualTo("O-1");
    }
}
