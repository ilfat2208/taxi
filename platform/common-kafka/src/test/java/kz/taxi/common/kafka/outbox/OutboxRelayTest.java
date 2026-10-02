package kz.taxi.common.kafka.outbox;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.kafka.support.TestJson;
import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.core.outbox.OutboxStatus;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OutboxRelayTest {

    public record PaymentCompleted(String paymentId, long amountMinor) {
    }

    private final ObjectMapper objectMapper = TestJson.mapper();
    private final EventEnvelopeCodec codec = new EventEnvelopeCodec(objectMapper);
    private final OutboxProperties properties = new OutboxProperties(
            true, Duration.ofMillis(100), 50, 3, Duration.ofSeconds(1), 7);

    private OutboxRepository repository;
    private KafkaTemplate<String, String> kafkaTemplate;
    private OutboxRelay relay;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        repository = mock(OutboxRepository.class);
        kafkaTemplate = mock(KafkaTemplate.class);
        relay = new OutboxRelay(repository, kafkaTemplate, codec, properties);
    }

    private OutboxMessage message(String id) {
        EventEnvelope<PaymentCompleted> envelope = EventEnvelope.of(
                "payment.completed", "Payment", "P-" + id, 1L, new PaymentCompleted("P-" + id, 1_000));
        return new OutboxMessage(envelope.eventId(), "payment.events", envelope.eventType(),
                envelope.aggregateType(), envelope.aggregateId(), envelope.partitionKey(),
                codec.encode(envelope), codec.encodeHeaders(envelope));
    }

    @SuppressWarnings("unchecked")
    private void succeedSends() {
        when(kafkaTemplate.send(any(ProducerRecord.class)))
                .thenAnswer(invocation -> CompletableFuture.completedFuture(
                        new SendResult<>(invocation.getArgument(0), null)));
    }

    @SuppressWarnings("unchecked")
    private void failSends() {
        when(kafkaTemplate.send(any(ProducerRecord.class)))
                .thenReturn(CompletableFuture.failedFuture(new RuntimeException("broker unavailable")));
    }

    @Test
    @DisplayName("does nothing when the outbox is empty")
    void skips_empty_batch() {
        when(repository.claimBatch(anyInt(), any(Pageable.class))).thenReturn(List.of());

        relay.publishPending();

        verify(kafkaTemplate, never()).send(any(ProducerRecord.class));
    }

    @Test
    @DisplayName("publishes a committed row with the aggregate id as the message key")
    void publishes_pending_row() {
        OutboxMessage row = message("1");
        when(repository.claimBatch(anyInt(), any(Pageable.class))).thenReturn(List.of(row));
        succeedSends();

        relay.publishPending();

        ArgumentCaptor<ProducerRecord<String, String>> captor = ArgumentCaptor.forClass(ProducerRecord.class);
        verify(kafkaTemplate).send(captor.capture());
        ProducerRecord<String, String> record = captor.getValue();

        assertThat(record.topic()).isEqualTo("payment.events");
        assertThat(record.key()).isEqualTo("P-1");
        assertThat(record.value()).contains("payment.completed");
        assertThat(record.headers().lastHeader(EventEnvelopeCodec.HEADER_EVENT_TYPE)).isNotNull();
        assertThat(record.headers().lastHeader(EventEnvelopeCodec.HEADER_CORRELATION_ID)).isNotNull();

        assertThat(row.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
        assertThat(row.getPublishedAt()).isNotNull();
        assertThat(row.getAttempts()).isZero();
    }

    @Test
    @DisplayName("keeps a failed row pending and counts the attempt")
    void marks_failure_and_retries() {
        OutboxMessage row = message("2");
        when(repository.claimBatch(anyInt(), any(Pageable.class))).thenReturn(List.of(row));
        failSends();

        relay.publishPending();

        assertThat(row.getStatus()).isEqualTo(OutboxStatus.FAILED);
        assertThat(row.getAttempts()).isEqualTo(1);
        assertThat(row.getLastError()).contains("broker unavailable");
        assertThat(row.getPublishedAt()).isNull();
    }

    @Test
    @DisplayName("one bad row does not stop the rest of the batch")
    void isolates_failures_per_row() {
        OutboxMessage first = message("3");
        OutboxMessage second = message("4");
        when(repository.claimBatch(anyInt(), any(Pageable.class))).thenReturn(List.of(first, second));
        when(kafkaTemplate.send(any(ProducerRecord.class)))
                .thenReturn(CompletableFuture.failedFuture(new RuntimeException("nope")))
                .thenAnswer(invocation -> CompletableFuture.completedFuture(
                        new SendResult<>(invocation.getArgument(0), null)));

        relay.publishPending();

        verify(kafkaTemplate, times(2)).send(any(ProducerRecord.class));
        assertThat(first.getStatus()).isEqualTo(OutboxStatus.FAILED);
        assertThat(second.getStatus()).isEqualTo(OutboxStatus.PUBLISHED);
    }

    @Test
    @DisplayName("parks a row after max attempts without blocking others")
    void parks_exhausted_row() {
        OutboxMessage row = message("5");
        for (int i = 0; i < properties.maxAttempts(); i++) {
            row.markFailed("still failing");
        }

        assertThat(row.hasExhaustedAttempts(properties.maxAttempts())).isTrue();
        assertThat(row.getAttempts()).isEqualTo(properties.maxAttempts());
    }

    @Test
    @DisplayName("asks only for rows that still deserve a retry")
    void requests_bounded_batch() {
        when(repository.claimBatch(anyInt(), any(Pageable.class))).thenReturn(List.of());

        relay.publishPending();

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).claimBatch(org.mockito.ArgumentMatchers.eq(properties.maxAttempts()),
                pageable.capture());
        assertThat(pageable.getValue().getPageSize()).isEqualTo(properties.batchSize());
    }

    @Test
    @DisplayName("purges published rows once they age out")
    void purges_old_rows() {
        when(repository.deletePublishedBefore(any())).thenReturn(3);

        relay.purgePublished();

        verify(repository).deletePublishedBefore(any());
    }

    @Test
    @DisplayName("reports pending work for monitoring")
    void reports_pending_count() {
        when(repository.countByStatus(OutboxStatus.PENDING)).thenReturn(2L);
        when(repository.countByStatus(OutboxStatus.FAILED)).thenReturn(1L);

        assertThat(relay.pendingCount()).isEqualTo(3L);
        assertThat(Map.of("pending", relay.pendingCount())).containsEntry("pending", 3L);
    }
}

