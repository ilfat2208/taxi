package kz.taxi.common.kafka.consumer;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Test/dev implementation of {@link ProcessedEventStore}. */
public class InMemoryProcessedEventStore implements ProcessedEventStore {

    private final Map<String, Instant> processed = new ConcurrentHashMap<>();
    private final Duration ttl;

    public InMemoryProcessedEventStore(Duration ttl) {
        this.ttl = ttl;
    }

    @Override
    public boolean claim(String consumerName, String eventId) {
        Instant now = Instant.now();
        Instant previous = processed.putIfAbsent(key(consumerName, eventId), now);
        if (previous == null) {
            return true;
        }
        if (previous.plus(ttl).isBefore(now)) {
            processed.put(key(consumerName, eventId), now);
            return true;
        }
        return false;
    }

    @Override
    public void release(String consumerName, String eventId) {
        processed.remove(key(consumerName, eventId));
    }

    @Override
    public boolean isProcessed(String consumerName, String eventId) {
        Instant when = processed.get(key(consumerName, eventId));
        return when != null && !when.plus(ttl).isBefore(Instant.now());
    }

    @Override
    public Optional<Instant> processedAt(String consumerName, String eventId) {
        return Optional.ofNullable(processed.get(key(consumerName, eventId)));
    }

    private String key(String consumerName, String eventId) {
        return consumerName + ":" + eventId;
    }
}
