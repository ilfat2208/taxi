package kz.taxi.dispatch.infrastructure;

import kz.taxi.dispatch.domain.DriverPosition;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.geo.Distance;
import org.springframework.data.geo.GeoResults;
import org.springframework.data.geo.Point;
import org.springframework.data.redis.connection.RedisGeoCommands;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.domain.geo.GeoReference;
import org.springframework.data.redis.domain.geo.Metrics;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Where the fleet is, as Redis sees it.
 *
 * <p>Two keys per driver, with different jobs:
 * <ul>
 *   <li>a <strong>GEO index</strong> ({@code dispatch:geo:drivers}) — answers "who
 *       is near this point" in one command, which is the only question dispatch
 *       asks thousands of times a minute;</li>
 *   <li>a <strong>TTL'd record</strong> ({@code dispatch:pos:<driverId>}) — carries
 *       what the index cannot: heading, speed, accuracy and, most importantly, the
 *       moment the reading was taken.</li>
 * </ul>
 *
 * <p>The TTL is the failure handling. There is no "driver went silent" job: if the
 * app stops sending, the record expires and the driver stops being a candidate.
 * A cleanup job would be a second, weaker copy of the same rule.
 */
@Component
@Slf4j
public class DriverLocationStore {

    static final String GEO_KEY = "dispatch:geo:drivers";
    static final String POSITION_PREFIX = "dispatch:pos:";

    private final StringRedisTemplate redis;
    private final DispatchProperties properties;

    public DriverLocationStore(StringRedisTemplate redis, DispatchProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    /** Records the newest known position of a driver and refreshes its TTL. */
    public void record(String driverId, DriverPosition position) {
        redis.opsForGeo().add(GEO_KEY, new Point(position.lon(), position.lat()), driverId);
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("lat", Double.toString(position.lat()));
        fields.put("lon", Double.toString(position.lon()));
        fields.put("headingDeg", Double.toString(position.headingDeg()));
        fields.put("speedKph", Double.toString(position.speedKph()));
        fields.put("accuracyM", Double.toString(position.accuracyM()));
        fields.put("at", position.at().toString());
        String key = POSITION_PREFIX + driverId;
        redis.opsForHash().putAll(key, fields);
        redis.expire(key, properties.getPositionTtl());
    }

    public Optional<DriverPosition> position(String driverId) {
        Map<Object, Object> fields = redis.opsForHash().entries(POSITION_PREFIX + driverId);
        if (fields.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(new DriverPosition(
                    Double.parseDouble(String.valueOf(fields.get("lat"))),
                    Double.parseDouble(String.valueOf(fields.get("lon"))),
                    Double.parseDouble(String.valueOf(fields.get("headingDeg"))),
                    Double.parseDouble(String.valueOf(fields.get("speedKph"))),
                    Double.parseDouble(String.valueOf(fields.get("accuracyM"))),
                    Instant.parse(String.valueOf(fields.get("at")))));
        } catch (RuntimeException e) {
            // A half-written record is worth less than no record: a driver without a
            // trustworthy position must not be offered a trip.
            log.warn("dropping unusable position record of driver {}: {}", driverId, e.toString());
            return Optional.empty();
        }
    }

    /**
     * Candidates around a point, nearest first.
     *
     * <p>{@code GEOSEARCH ... BYRADIUS ASC} does the ranking: distance from the
     * pickup point, not from the city centre, and the ordering comes back from the
     * index instead of being recomputed in Java for every request.
     */
    public List<Nearby> nearest(double lat, double lon, int radiusM, int limit) {
        GeoReference<String> center = GeoReference.fromCoordinate(lon, lat);
        RedisGeoCommands.GeoSearchCommandArgs args = RedisGeoCommands.GeoSearchCommandArgs.newGeoSearchArgs()
                .includeDistance()
                .includeCoordinates()
                .sortAscending()
                .limit(limit);
        GeoResults<RedisGeoCommands.GeoLocation<String>> results = redis.opsForGeo()
                .search(GEO_KEY, center, new Distance(radiusM, Metrics.METERS), args);
        if (results == null) {
            return List.of();
        }
        List<Nearby> nearby = new ArrayList<>();
        results.forEach(result -> {
            RedisGeoCommands.GeoLocation<String> location = result.getContent();
            nearby.add(new Nearby(
                    location.getName(),
                    location.getPoint().getY(),
                    location.getPoint().getX(),
                    result.getDistance() == null ? 0d : result.getDistance().getValue()));
        });
        return nearby;
    }

    /** Forgets a driver entirely: used when he goes off duty, so his last position is not kept. */
    public void forget(String driverId) {
        redis.opsForGeo().remove(GEO_KEY, driverId);
        redis.delete(POSITION_PREFIX + driverId);
    }

    /** A candidate as the index reported it. */
    public record Nearby(String driverId, double lat, double lon, double distanceM) {
    }
}
