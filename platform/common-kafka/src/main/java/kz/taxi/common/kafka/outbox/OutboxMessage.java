package kz.taxi.common.kafka.outbox;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.outbox.OutboxStatus;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One pending domain event, committed in the same transaction as the aggregate
 * change it describes.
 *
 * <p>This is the transactional outbox pattern, and it exists to close the
 * classic dual-write hole:
 *
 * <pre>
 *   bad :  tx.commit(aggregate); kafka.send(event);   // crash between the two -> lost event
 *   bad :  kafka.send(event);    tx.commit(aggregate); // crash between the two -> phantom event
 *   good:  tx { aggregate.save(); outbox.save(event); }  -> relay publishes afterwards
 * </pre>
 *
 * <p>The table is append-only except for {@code status} and {@code attempts},
 * which is what makes it cheap to relay and easy to audit. Rows are keyed by
 * ULID so that {@code order by id} is chronological and index-friendly.
 */
@Entity
@Table(name = "outbox_message")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OutboxMessage {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "topic", length = 128, nullable = false, updatable = false)
    private String topic;

    @Column(name = "event_type", length = 128, nullable = false, updatable = false)
    private String eventType;

    @Column(name = "aggregate_type", length = 64, nullable = false, updatable = false)
    private String aggregateType;

    @Column(name = "aggregate_id", length = 64, nullable = false, updatable = false)
    private String aggregateId;

    /** Kafka message key: keeps per-aggregate ordering in the partition. */
    @Column(name = "partition_key", length = 64, nullable = false, updatable = false)
    private String partitionKey;

    @Column(name = "payload", nullable = false, updatable = false, columnDefinition = "text")
    private String payload;

    @Column(name = "headers", columnDefinition = "text")
    private String headers;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private OutboxStatus status;

    @Column(name = "attempts", nullable = false)
    private int attempts;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;

    /** Guards against two relay instances publishing the same row. */
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    public OutboxMessage(String id,
                         String topic,
                         String eventType,
                         String aggregateType,
                         String aggregateId,
                         String partitionKey,
                         String payload,
                         String headers) {
        this.id = id;
        this.topic = topic;
        this.eventType = eventType;
        this.aggregateType = aggregateType;
        this.aggregateId = aggregateId;
        this.partitionKey = partitionKey;
        this.payload = payload;
        this.headers = headers;
        this.status = OutboxStatus.PENDING;
        this.attempts = 0;
        this.createdAt = Instant.now();
    }

    public void markPublished() {
        this.status = OutboxStatus.PUBLISHED;
        this.publishedAt = Instant.now();
        this.lastError = null;
    }

    public void markFailed(String error) {
        this.attempts++;
        this.status = OutboxStatus.FAILED;
        this.lastError = error == null ? null : error.substring(0, Math.min(error.length(), 2000));
    }

    public boolean hasExhaustedAttempts(int maxAttempts) {
        return attempts >= maxAttempts;
    }
}
