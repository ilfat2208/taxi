package kz.taxi.common.kafka.outbox;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * @param enabled        turns the relay off (e.g. for a read-only replica)
 * @param pollInterval   how often the relay looks for unpublished rows
 * @param batchSize      rows claimed per poll — keeps the transaction short
 * @param maxAttempts    after this many failures a row stops being retried and awaits an operator
 * @param sendTimeout    how long to wait for the broker acknowledgement inside the transaction
 * @param retentionDays  how long published rows are kept before cleanup (audit trail)
 */
@ConfigurationProperties(prefix = "taxi.outbox")
public record OutboxProperties(
        boolean enabled,
        Duration pollInterval,
        int batchSize,
        int maxAttempts,
        Duration sendTimeout,
        int retentionDays
) {

    public OutboxProperties {
        pollInterval = pollInterval == null ? Duration.ofMillis(500) : pollInterval;
        batchSize = batchSize <= 0 ? 100 : batchSize;
        maxAttempts = maxAttempts <= 0 ? 10 : maxAttempts;
        sendTimeout = sendTimeout == null ? Duration.ofSeconds(10) : sendTimeout;
        retentionDays = retentionDays <= 0 ? 7 : retentionDays;
    }
}
