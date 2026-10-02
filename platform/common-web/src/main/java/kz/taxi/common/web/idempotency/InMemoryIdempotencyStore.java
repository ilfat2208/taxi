package kz.taxi.common.web.idempotency;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-process store used by tests and by single-instance deployments without
 * Redis. Same guarantees as the Redis one, except that it does not survive a
 * restart and cannot be shared between replicas.
 */
public class InMemoryIdempotencyStore implements IdempotencyStore {

    private record Entry(StoredResponse response, Instant expiresAt) {
    }

    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final Duration ttl;

    public InMemoryIdempotencyStore(Duration ttl) {
        this.ttl = ttl;
    }

    @Override
    public synchronized boolean tryAcquire(String key, String requestHash) {
        purgeExpired(key);
        if (entries.containsKey(key)) {
            return false;
        }
        entries.put(key, new Entry(new StoredResponse(State.IN_PROGRESS, requestHash, null),
                Instant.now().plus(ttl)));
        return true;
    }

    @Override
    public synchronized Optional<StoredResponse> find(String key) {
        purgeExpired(key);
        return Optional.ofNullable(entries.get(key)).map(Entry::response);
    }

    @Override
    public synchronized void complete(String key, String requestHash, String responseJson) {
        entries.put(key, new Entry(new StoredResponse(State.COMPLETED, requestHash, responseJson),
                Instant.now().plus(ttl)));
    }

    @Override
    public synchronized void release(String key) {
        entries.remove(key);
    }

    private void purgeExpired(String key) {
        Entry entry = entries.get(key);
        if (entry != null && entry.expiresAt().isBefore(Instant.now())) {
            entries.remove(key);
        }
    }
}
