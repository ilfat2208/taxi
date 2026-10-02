package kz.taxi.common.web.idempotency;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * @param keyPrefix        Redis key namespace, so several apps can share one Redis
 * @param ttl              how long a completed response stays replayable
 * @param headerName       request header carrying the client-generated key
 * @param maxKeyLength     hard cap to keep Redis keys bounded
 * @param store            {@code redis} (production) or {@code memory} (tests, single node)
 */
@ConfigurationProperties(prefix = "taxi.idempotency")
public record IdempotencyProperties(
        String keyPrefix,
        Duration ttl,
        String headerName,
        int maxKeyLength,
        Store store
) {

    public enum Store {
        REDIS, MEMORY
    }

    public IdempotencyProperties {
        keyPrefix = keyPrefix == null || keyPrefix.isBlank() ? "taxi:idem:" : keyPrefix;
        ttl = ttl == null ? Duration.ofHours(24) : ttl;
        headerName = headerName == null || headerName.isBlank() ? "Idempotency-Key" : headerName;
        maxKeyLength = maxKeyLength <= 0 ? 128 : maxKeyLength;
        store = store == null ? Store.REDIS : store;
    }
}
