package kz.taxi.common.kafka.consumer;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * @param keyPrefix Redis namespace for processed-event markers
 * @param ttl       how long a processed event is remembered; must exceed the
 *                  worst-case redelivery window (Kafka retention is 7 days here)
 * @param store     {@code redis} (shared between replicas) or {@code memory}
 */
@ConfigurationProperties(prefix = "taxi.kafka.dedup")
public record ProcessedEventProperties(String keyPrefix, Duration ttl, Store store) {

    public enum Store {
        REDIS, MEMORY
    }

    public ProcessedEventProperties {
        keyPrefix = keyPrefix == null || keyPrefix.isBlank() ? "taxi:events:" : keyPrefix;
        ttl = ttl == null ? Duration.ofDays(7) : ttl;
        store = store == null ? Store.REDIS : store;
    }
}
