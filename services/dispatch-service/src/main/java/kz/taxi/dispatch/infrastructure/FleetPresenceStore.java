package kz.taxi.dispatch.infrastructure;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.dispatch.domain.DriverPresence;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The fleet projection: who is on duty, and how to reach him.
 *
 * <p>Rebuilt from {@code driver.events} and from nothing else — no synchronous
 * call to the driver service, no shared table. That is the whole point of the
 * projection: the candidate search runs on the hot path, and a network hop per
 * driver would make "who is near this pickup point" unaffordable.
 *
 * <p>Three keys, each with one job:
 * <ul>
 *   <li>{@code dispatch:presence} — hash {@code driverId -> profile} (all known drivers);</li>
 *   <li>{@code dispatch:duty} — set of on-duty driver ids, so listing the fleet is
 *       a {@code SMEMBERS} and not a scan over everybody who ever drove;</li>
 *   <li>{@code dispatch:presence:by-user} — {@code userId -> driverId}, which is how
 *       an incoming position (authenticated by user) is attributed to a driver.</li>
 * </ul>
 */
@Component
@Slf4j
public class FleetPresenceStore {

    static final String PRESENCE_KEY = "dispatch:presence";
    static final String DUTY_KEY = "dispatch:duty";
    static final String BY_USER_KEY = "dispatch:presence:by-user";

    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;

    public FleetPresenceStore(StringRedisTemplate redis, ObjectMapper objectMapper) {
        this.redis = redis;
        this.objectMapper = objectMapper;
    }

    /** Applies a state change. Off duty removes the driver from the candidate set. */
    public void upsert(DriverPresence presence) {
        redis.opsForHash().put(PRESENCE_KEY, presence.driverId(), write(presence));
        redis.opsForHash().put(BY_USER_KEY, presence.userId(), presence.driverId());
        if (presence.onDuty()) {
            redis.opsForSet().add(DUTY_KEY, presence.driverId());
        } else {
            redis.opsForSet().remove(DUTY_KEY, presence.driverId());
        }
        log.debug("fleet projection: driver {} is {}", presence.driverId(), presence.status());
    }

    public Optional<DriverPresence> find(String driverId) {
        Object raw = redis.opsForHash().get(PRESENCE_KEY, driverId);
        if (raw == null) {
            return Optional.empty();
        }
        try {
            return Optional.of(objectMapper.readValue(String.valueOf(raw), DriverPresence.class));
        } catch (JsonProcessingException e) {
            // A corrupt projection entry is dropped and skipped, never guessed at:
            // a driver with a nonsense profile must not receive trips, and one bad
            // record must not take the whole fleet view down.
            log.warn("dropping unreadable presence record of driver {}: {}", driverId, e.toString());
            redis.opsForHash().delete(PRESENCE_KEY, driverId);
            return Optional.empty();
        }
    }

    public Optional<DriverPresence> findByUserId(String userId) {
        Object driverId = redis.opsForHash().get(BY_USER_KEY, userId);
        if (driverId == null) {
            return Optional.empty();
        }
        return find(String.valueOf(driverId));
    }

    /** Everyone on duty, whatever their position looks like. */
    public List<DriverPresence> onDuty() {
        Set<String> ids = redis.opsForSet().members(DUTY_KEY);
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        List<DriverPresence> fleet = new ArrayList<>(ids.size());
        for (String driverId : ids) {
            find(driverId).ifPresent(fleet::add);
        }
        return fleet;
    }

    public Set<String> onDutyIds() {
        Set<String> ids = redis.opsForSet().members(DUTY_KEY);
        return ids == null ? Set.of() : ids;
    }

    public long onDutyCount() {
        Long size = redis.opsForSet().size(DUTY_KEY);
        return size == null ? 0L : size;
    }

    private String write(DriverPresence presence) {
        try {
            return objectMapper.writeValueAsString(presence);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot serialise driver presence " + presence.driverId(), e);
        }
    }
}
