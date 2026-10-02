package kz.taxi.dispatch.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.dispatch.domain.DispatchErrorCode;
import kz.taxi.dispatch.domain.DriverPosition;
import kz.taxi.dispatch.domain.DriverPresence;
import kz.taxi.dispatch.domain.GeoMath;
import kz.taxi.dispatch.infrastructure.DispatchProperties;
import kz.taxi.dispatch.infrastructure.DriverLocationStore;
import kz.taxi.dispatch.infrastructure.FleetPresenceStore;
import kz.taxi.dispatch.infrastructure.kafka.DriverStateEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The live fleet: who is on duty, where they are, and who is nearest.
 *
 * <p>Two reads and one write, and the interesting decisions are in the reads:
 * <ul>
 *   <li>{@link #snapshot} answers "show me the map" — it deliberately includes
 *       positions that have gone stale, flagged, because a dispatcher staring at a
 *       driver who stopped reporting needs to see him, not an empty map;</li>
 *   <li>{@link #candidates} answers "who can take this trip" — and there the
 *       tolerance is zero: an off-duty driver, a busy driver and a stale position
 *       are all excluded. Offering a trip the driver cannot accept wastes the
 *       rider's time and burns the driver's acceptance rate.</li>
 * </ul>
 */
@Service
@Slf4j
public class FleetService {

    /**
     * How many cars to pull from the index per candidate we actually return.
     *
     * <p>The index ranks everyone in the radius; only available drivers with a
     * fresh position may be returned, so a fetch exactly equal to the limit would
     * routinely come back short. The factor is a pragmatic guess, and the final
     * limit is still enforced.
     */
    private static final int CANDIDATE_OVERFETCH = 4;

    private final FleetPresenceStore presenceStore;
    private final DriverLocationStore locationStore;
    private final DispatchProperties properties;

    public FleetService(FleetPresenceStore presenceStore,
                        DriverLocationStore locationStore,
                        DispatchProperties properties) {
        this.presenceStore = presenceStore;
        this.locationStore = locationStore;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ projection

    /**
     * Applies a driver state change coming from {@code driver.events}.
     *
     * <p>Going off duty also drops the last position: the fleet map must not keep
     * showing a driver who finished his shift, and a location nobody needs is
     * personal data we have no reason to hold.
     */
    public void applyDriverState(String eventType, DriverStateEvent event) {
        presenceStore.upsert(new DriverPresence(
                event.driverId(), event.userId(), event.displayName(), event.phone(), event.status()));
        if (DriverPresence.OFFLINE.equals(event.status())) {
            locationStore.forget(event.driverId());
        }
        log.debug("applied {} for driver {} ({})", eventType, event.driverId(), event.status());
    }

    // ------------------------------------------------------------------ reads

    /** The map. Stale positions are included when asked, and always flagged. */
    public FleetView snapshot(boolean includeStale) {
        Instant now = Instant.now();
        Duration tolerance = properties.getStaleAfter();
        List<DriverPresence> duty = presenceStore.onDuty();
        List<DriverView> drivers = new ArrayList<>(duty.size());
        int withPosition = 0;

        for (DriverPresence presence : duty) {
            Optional<DriverPosition> found = locationStore.position(presence.driverId());
            if (found.isEmpty()) {
                // On duty but silent: he counts in the total, not on the map.
                continue;
            }
            withPosition++;
            DriverPosition position = found.get();
            boolean stale = GeoMath.isStale(position.at(), now, tolerance);
            if (stale && !includeStale) {
                continue;
            }
            drivers.add(new DriverView(
                    presence.driverId(),
                    presence.displayName(),
                    presence.phone(),
                    presence.status(),
                    position.lat(),
                    position.lon(),
                    position.headingDeg(),
                    position.speedKph(),
                    ageSeconds(position.at(), now),
                    stale));
        }

        // Freshest first: on a map with a dozen cars, the reliable ones matter most.
        drivers.sort(Comparator.comparingLong(DriverView::ageSeconds));
        return new FleetView(now, tolerance.toSeconds(), duty.size(), withPosition, List.copyOf(drivers));
    }

    /** Who dispatch may offer a trip to right now, nearest first. */
    public CandidateList candidates(double lat, double lon, int radiusM, int limit) {
        int safeRadius = resolveRadius(radiusM);
        int safeLimit = limit <= 0 ? properties.getDefaultLimit() : Math.min(limit, properties.getMaxLimit());
        int fetch = Math.min(properties.getMaxLimit() * CANDIDATE_OVERFETCH, safeLimit * CANDIDATE_OVERFETCH);
        Instant now = Instant.now();
        Duration tolerance = properties.getStaleAfter();
        Set<String> onDuty = presenceStore.onDutyIds();

        List<Candidate> candidates = new ArrayList<>();
        for (DriverLocationStore.Nearby nearby : locationStore.nearest(lat, lon, safeRadius, fetch)) {
            if (!onDuty.contains(nearby.driverId())) {
                continue;
            }
            Optional<DriverPresence> presence = presenceStore.find(nearby.driverId());
            if (presence.isEmpty() || !presence.get().available()) {
                // Busy drivers are on duty but already carrying somebody.
                continue;
            }
            Optional<DriverPosition> position = locationStore.position(nearby.driverId());
            if (position.isEmpty() || GeoMath.isStale(position.get().at(), now, tolerance)) {
                continue;
            }
            candidates.add(new Candidate(
                    nearby.driverId(),
                    presence.get().displayName(),
                    nearby.lat(),
                    nearby.lon(),
                    nearby.distanceM(),
                    ageSeconds(position.get().at(), now)));
            if (candidates.size() >= safeLimit) {
                break;
            }
        }
        return new CandidateList(now, safeRadius, List.copyOf(candidates));
    }

    /**
     * Turns "no radius given" into the configured default and refuses a radius
     * larger than the fleet is allowed to search.
     *
     * <p>{@code 0} (or a missing parameter) means "use the default", exactly like
     * {@code limit}: a caller that does not care must not have to know the number.
     */
    private int resolveRadius(int radiusM) {
        int resolved = radiusM <= 0 ? properties.getDefaultRadiusM() : radiusM;
        if (resolved > properties.getMaxRadiusM()) {
            throw DomainException.of(DispatchErrorCode.INVALID_RADIUS,
                            "radius {} m is greater than the allowed {} m", resolved, properties.getMaxRadiusM())
                    .withDetail("radiusM", resolved)
                    .withDetail("maxRadiusM", properties.getMaxRadiusM());
        }
        return resolved;
    }

    private static long ageSeconds(Instant at, Instant now) {
        return Math.max(0L, Duration.between(at, now).toSeconds());
    }

    // ------------------------------------------------------------------ views

    /** One car on the map. */
    public record DriverView(String driverId,
                             String displayName,
                             String phone,
                             String status,
                             double lat,
                             double lon,
                             double headingDeg,
                             double speedKph,
                             long ageSeconds,
                             boolean stale) {
    }

    /** The whole map, with the counters a dispatcher needs to trust it. */
    public record FleetView(Instant generatedAt,
                            long staleAfterSeconds,
                            int onDuty,
                            int withPosition,
                            List<DriverView> drivers) {
    }

    /** A driver dispatch may actually offer the trip to, nearest first. */
    public record Candidate(String driverId,
                            String displayName,
                            double lat,
                            double lon,
                            double distanceM,
                            long ageSeconds) {
    }

    /**
     * The answer to "who is near this point", with the radius it was asked for.
     *
     * <p>The radius travels back with the candidates because the caller may have
     * sent {@code 0} meaning "use the default": the response must say which radius
     * actually produced this list.
     */
    public record CandidateList(Instant generatedAt, int radiusM, List<Candidate> candidates) {
    }
}
