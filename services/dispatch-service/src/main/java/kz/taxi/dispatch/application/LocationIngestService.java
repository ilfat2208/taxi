package kz.taxi.dispatch.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.dispatch.domain.DispatchErrorCode;
import kz.taxi.dispatch.domain.DriverPosition;
import kz.taxi.dispatch.domain.DriverPresence;
import kz.taxi.dispatch.domain.GeoMath;
import kz.taxi.dispatch.infrastructure.DispatchProperties;
import kz.taxi.dispatch.infrastructure.DriverLocationStore;
import kz.taxi.dispatch.infrastructure.FleetPresenceStore;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;

/**
 * Accepts positions from driver apps.
 *
 * <p>Deliberately strict about three things:
 * <ul>
 *   <li><strong>who</strong> — the caller is authenticated as a platform user, and
 *       the position is attributed through the fleet projection
 *       ({@code userId -> driverId}). A user without a driver profile cannot inject
 *       cars into the index;</li>
 *   <li><strong>when</strong> — only an on-duty driver sends positions. A driver who
 *       finished his shift must fall out of the map at once, not in two minutes when
 *       the last position expires;</li>
 *   <li><strong>what</strong> — a coordinate that cannot be a car in a city
 *       ({@code 0,0}, a speed of 900 km/h, a 50 km accuracy) is refused rather than
 *       stored, because one garbage point pollutes the candidate search for every
 *       rider nearby.</li>
 * </ul>
 *
 * <p>Of a batch, only the newest reading reaches the live index: the map and the
 * candidate search need "where is he now". The full trail is a different concern
 * with a different owner (PostGIS, Ф2), and keeping two copies of a GPS stream
 * would guarantee they disagree.
 */
@Service
@Slf4j
public class LocationIngestService {

    private final FleetPresenceStore presenceStore;
    private final DriverLocationStore locationStore;
    private final DispatchProperties properties;

    public LocationIngestService(FleetPresenceStore presenceStore,
                                 DriverLocationStore locationStore,
                                 DispatchProperties properties) {
        this.presenceStore = presenceStore;
        this.locationStore = locationStore;
        this.properties = properties;
    }

    public IngestResult record(String userId, List<DriverPosition> points) {
        if (points == null || points.isEmpty()) {
            throw DomainException.of(DispatchErrorCode.INVALID_POSITION, "the request carries no points");
        }
        if (points.size() > properties.getMaxBatchSize()) {
            throw DomainException.of(DispatchErrorCode.TOO_MANY_POINTS,
                            "{} points in one batch, at most {} are accepted", points.size(),
                            properties.getMaxBatchSize())
                    .withDetail("points", points.size())
                    .withDetail("maxBatchSize", properties.getMaxBatchSize());
        }

        DriverPresence presence = presenceStore.findByUserId(userId)
                .orElseThrow(() -> DomainException.of(DispatchErrorCode.DRIVER_NOT_FOUND,
                                "no driver profile for user {}", userId)
                        .withDetail("userId", userId));
        if (!presence.onDuty()) {
            throw DomainException.of(DispatchErrorCode.DRIVER_NOT_ON_DUTY,
                            "driver {} is {} and must not report positions", presence.driverId(), presence.status())
                    .withDetail("status", presence.status());
        }

        points.forEach(point -> GeoMath.requireValid(
                point.lat(), point.lon(), point.accuracyM(), point.speedKph()));

        DriverPosition newest = points.stream()
                .max(Comparator.comparing(DriverPosition::at))
                .orElseThrow();
        locationStore.record(presence.driverId(), newest);
        log.debug("position of driver {} recorded at {},{}", presence.driverId(), newest.lat(), newest.lon());
        return new IngestResult(presence.driverId(), points.size(), newest.at());
    }

    /** {@code accepted} counts the points taken; the index keeps the newest one. */
    public record IngestResult(String driverId, int accepted, Instant recordedAt) {
    }
}
