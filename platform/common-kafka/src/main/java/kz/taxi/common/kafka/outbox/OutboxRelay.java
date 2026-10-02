package kz.taxi.common.kafka.outbox;

import kz.taxi.common.core.outbox.OutboxStatus;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.springframework.data.domain.PageRequest;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Publishes committed outbox rows to Kafka.
 *
 * <p>Design choices worth knowing when debugging:
 * <ul>
 *   <li>At-least-once, never "at-most-once": a row is marked {@code PUBLISHED}
 *       only after the broker acknowledged it, so a crash can duplicate a record
 *       but can never drop one. Consumers deduplicate by {@code eventId}.</li>
 *   <li>The send is awaited inside the transaction. That trades some throughput
 *       for a simple, correct invariant — a row is either published or still
 *       pending, never "sent but not recorded". Raising the batch size and the
 *       poll interval is the knob if a topic gets hot.</li>
 *   <li>Failures are per row: one broken record does not block the rest of the
 *       batch, and after {@code max-attempts} the row is parked for an operator
 *       instead of poisoning the relay forever.</li>
 * </ul>
 */
@Slf4j
public class OutboxRelay {

    private final OutboxRepository repository;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final EventEnvelopeCodec codec;
    private final OutboxProperties properties;

    public OutboxRelay(OutboxRepository repository,
                       KafkaTemplate<String, String> kafkaTemplate,
                       EventEnvelopeCodec codec,
                       OutboxProperties properties) {
        this.repository = repository;
        this.kafkaTemplate = kafkaTemplate;
        this.codec = codec;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${taxi.outbox.poll-interval-ms:500}",
            initialDelayString = "${taxi.outbox.initial-delay-ms:2000}")
    @Transactional
    public void publishPending() {
        List<OutboxMessage> batch = repository.claimBatch(properties.maxAttempts(),
                PageRequest.of(0, properties.batchSize()));
        if (batch.isEmpty()) {
            return;
        }

        int published = 0;
        for (OutboxMessage message : batch) {
            try {
                publish(message);
                message.markPublished();
                published++;
            } catch (Exception failure) {
                message.markFailed(failure.getMessage());
                log.error("outbox publish failed [id={}, event={}, attempts={}]",
                        message.getId(), message.getEventType(), message.getAttempts(), failure);
                if (message.hasExhaustedAttempts(properties.maxAttempts())) {
                    log.error("outbox row {} parked after {} attempts and needs operator attention: {}",
                            message.getId(), message.getAttempts(), message.getLastError());
                }
            }
        }
        // Entities are managed: dirty checking flushes the status changes with this commit.
        log.debug("outbox relay published {}/{} records", published, batch.size());
    }

    private void publish(OutboxMessage message) throws Exception {
        ProducerRecord<String, String> record = new ProducerRecord<>(
                message.getTopic(),
                null,
                message.getPartitionKey(),
                message.getPayload());

        Map<String, String> headers = codec.decodeHeaders(message.getHeaders());
        headers.forEach((key, value) -> {
            if (value != null) {
                record.headers().add(new RecordHeader(key, value.getBytes(StandardCharsets.UTF_8)));
            }
        });

        kafkaTemplate.send(record).get(properties.sendTimeout().toMillis(), TimeUnit.MILLISECONDS);
    }

    /** Keeps the table small: published rows are audit data, not working data. */
    @Scheduled(fixedDelayString = "${taxi.outbox.cleanup-interval-ms:3600000}",
            initialDelayString = "${taxi.outbox.cleanup-initial-delay-ms:60000}")
    @Transactional
    public void purgePublished() {
        Instant threshold = Instant.now().minus(properties.retentionDays(), ChronoUnit.DAYS);
        int removed = repository.deletePublishedBefore(threshold);
        if (removed > 0) {
            log.info("purged {} published outbox rows older than {} days", removed, properties.retentionDays());
        }
    }

    /** How much unpublished work is waiting — exposed through the service's admin endpoint. */
    @Transactional(readOnly = true)
    public long pendingCount() {
        return repository.countByStatus(OutboxStatus.PENDING) + repository.countByStatus(OutboxStatus.FAILED);
    }
}
