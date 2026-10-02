package kz.taxi.common.web.idempotency;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * Redis-backed store: one {@code SET NX PX} per request, which is the cheapest
 * correct primitive for cross-instance idempotency (a database unique index
 * would hold a row lock for the whole downstream call).
 */
@Slf4j
public class RedisIdempotencyStore implements IdempotencyStore {

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final IdempotencyProperties properties;

    public RedisIdempotencyStore(StringRedisTemplate redis,
                                 ObjectMapper objectMapper,
                                 IdempotencyProperties properties) {
        this.redis = redis;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    @Override
    public boolean tryAcquire(String key, String requestHash) {
        String payload = serialize(new StoredResponse(State.IN_PROGRESS, requestHash, null));
        Boolean acquired = redis.opsForValue().setIfAbsent(redisKey(key), payload,
                properties.ttl().toMillis(), TimeUnit.MILLISECONDS);
        return Boolean.TRUE.equals(acquired);
    }

    @Override
    public Optional<StoredResponse> find(String key) {
        String payload = redis.opsForValue().get(redisKey(key));
        if (payload == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readValue(payload, StoredResponse.class));
        } catch (Exception ex) {
            // Corrupt or foreign value: treat as absent rather than failing the payment.
            log.warn("discarding unreadable idempotency record for key={}", key, ex);
            return Optional.empty();
        }
    }

    @Override
    public void complete(String key, String requestHash, String responseJson) {
        String payload = serialize(new StoredResponse(State.COMPLETED, requestHash, responseJson));
        redis.opsForValue().set(redisKey(key), payload, properties.ttl().toMillis(), TimeUnit.MILLISECONDS);
    }

    @Override
    public void release(String key) {
        redis.delete(redisKey(key));
    }

    private String redisKey(String key) {
        return properties.keyPrefix() + key;
    }

    private String serialize(StoredResponse response) {
        try {
            return objectMapper.writeValueAsString(response);
        } catch (Exception ex) {
            throw new IllegalStateException("cannot serialize idempotency record", ex);
        }
    }
}
