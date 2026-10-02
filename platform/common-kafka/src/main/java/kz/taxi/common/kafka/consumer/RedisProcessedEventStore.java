package kz.taxi.common.kafka.consumer;

import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Instant;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Redis-backed dedup store: one {@code SET NX} per event, shared by all replicas
 * of a consumer group, with a TTL that comfortably exceeds any realistic
 * redelivery window.
 */
@Slf4j
public class RedisProcessedEventStore implements ProcessedEventStore {

    private final StringRedisTemplate redis;
    private final ProcessedEventProperties properties;

    public RedisProcessedEventStore(StringRedisTemplate redis, ProcessedEventProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public boolean claim(String consumerName, String eventId) {
        Boolean claimed = redis.opsForValue().setIfAbsent(key(consumerName, eventId),
                Instant.now().toString(), properties.ttl().toMillis(), TimeUnit.MILLISECONDS);
        return Boolean.TRUE.equals(claimed);
    }

    @Override
    public void release(String consumerName, String eventId) {
        redis.delete(key(consumerName, eventId));
    }

    @Override
    public boolean isProcessed(String consumerName, String eventId) {
        return Boolean.TRUE.equals(redis.hasKey(key(consumerName, eventId)));
    }

    @Override
    public Optional<Instant> processedAt(String consumerName, String eventId) {
        String value = redis.opsForValue().get(key(consumerName, eventId));
        if (value == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(Instant.parse(value));
        } catch (Exception ex) {
            log.debug("processed-event marker for {}/{} has an unexpected value: {}", consumerName, eventId, value);
            return Optional.empty();
        }
    }

    private String key(String consumerName, String eventId) {
        return properties.keyPrefix() + consumerName + ":" + eventId;
    }
}
