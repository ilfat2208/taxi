package kz.taxi.dispatch.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.dispatch.domain.DispatchErrorCode;
import kz.taxi.dispatch.domain.DriverPosition;
import kz.taxi.dispatch.domain.DriverPresence;
import kz.taxi.dispatch.infrastructure.DispatchProperties;
import kz.taxi.dispatch.infrastructure.DriverLocationStore;
import kz.taxi.dispatch.infrastructure.FleetPresenceStore;
import kz.taxi.dispatch.infrastructure.kafka.DriverStateEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The two questions the fleet view must answer differently: "show me the map" and
 * "who can take this trip".
 */
@ExtendWith(MockitoExtension.class)
class FleetServiceTest {

    @Mock
    private FleetPresenceStore presenceStore;

    @Mock
    private DriverLocationStore locationStore;

    private DispatchProperties properties;
    private FleetService service;

    @BeforeEach
    void setUp() {
        properties = new DispatchProperties();
        service = new FleetService(presenceStore, locationStore, properties);
    }

    private static DriverPresence presence(String driverId, String status) {
        return new DriverPresence(driverId, "U-" + driverId, "Водитель " + driverId, "+77001234567", status);
    }

    private static DriverPosition position(Instant at) {
        return DriverPosition.of(43.2389d, 76.8897d, 90d, 30d, 8d, at);
    }

    private static DriverLocationStore.Nearby nearby(String driverId, double distanceM) {
        return new DriverLocationStore.Nearby(driverId, 43.2389d, 76.8897d, distanceM);
    }

    // ------------------------------------------------------------------ projection

    @Test
    @DisplayName("an off-duty driver also loses his last position")
    void off_duty_forgets_position() {
        service.applyDriverState("driver.offline", new DriverStateEvent(
                "D-1", "U-1", "Айдар", "+77001234567", DriverPresence.OFFLINE, Instant.now()));

        verify(presenceStore).upsert(any(DriverPresence.class));
        // The map must not keep showing a driver who finished his shift, and a
        // location nobody needs is personal data we have no reason to hold.
        verify(locationStore).forget("D-1");
    }

    @Test
    @DisplayName("going on duty keeps the projection but touches no position")
    void online_keeps_position() {
        service.applyDriverState("driver.online", new DriverStateEvent(
                "D-1", "U-1", "Айдар", "+77001234567", DriverPresence.ONLINE, Instant.now()));

        verify(presenceStore).upsert(any(DriverPresence.class));
        verify(locationStore, never()).forget(any());
    }

    // ------------------------------------------------------------------ the map

    @Test
    @DisplayName("the map shows stale cars, flagged, and counts who is silent")
    void snapshot_marks_stale() {
        Instant now = Instant.now();
        when(presenceStore.onDuty()).thenReturn(List.of(
                presence("D-1", DriverPresence.ONLINE),
                presence("D-2", DriverPresence.ONLINE),
                presence("D-3", DriverPresence.ONLINE)));
        when(locationStore.position("D-1")).thenReturn(Optional.of(position(now.minusSeconds(2))));
        when(locationStore.position("D-2")).thenReturn(Optional.of(
                position(now.minusSeconds(properties.getStaleAfter().toSeconds() + 60))));
        when(locationStore.position("D-3")).thenReturn(Optional.empty());

        FleetService.FleetView view = service.snapshot(true);

        assertThat(view.onDuty()).isEqualTo(3);
        assertThat(view.withPosition()).isEqualTo(2);
        assertThat(view.drivers()).hasSize(2);
        // Freshest first: the driver you can rely on is at the top of the list.
        assertThat(view.drivers().get(0).driverId()).isEqualTo("D-1");
        assertThat(view.drivers().get(0).stale()).isFalse();
        assertThat(view.drivers().get(1).stale()).isTrue();
        assertThat(view.staleAfterSeconds()).isEqualTo(properties.getStaleAfter().toSeconds());
    }

    @Test
    @DisplayName("stale cars can be left out entirely")
    void snapshot_can_hide_stale() {
        Instant now = Instant.now();
        when(presenceStore.onDuty()).thenReturn(List.of(presence("D-1", DriverPresence.ONLINE)));
        when(locationStore.position("D-1")).thenReturn(Optional.of(
                position(now.minusSeconds(properties.getStaleAfter().toSeconds() + 60))));

        assertThat(service.snapshot(false).drivers()).isEmpty();
    }

    // ------------------------------------------------------------------ candidates

    @Test
    @DisplayName("only an available driver with a fresh position may take a trip")
    void candidates_filter_by_availability_and_freshness() {
        Instant now = Instant.now();
        when(presenceStore.onDutyIds()).thenReturn(Set.of("D-1", "D-2", "D-3", "D-4"));
        when(locationStore.nearest(anyDouble(), anyDouble(), anyInt(), anyInt())).thenReturn(List.of(
                nearby("D-1", 120d),   // online, fresh        -> candidate
                nearby("D-2", 200d),   // busy, carrying rider -> not a candidate
                nearby("D-3", 300d),   // online but silent    -> not a candidate
                nearby("D-9", 400d))); // not on duty at all   -> not a candidate
        when(presenceStore.find("D-1")).thenReturn(Optional.of(presence("D-1", DriverPresence.ONLINE)));
        when(presenceStore.find("D-2")).thenReturn(Optional.of(presence("D-2", DriverPresence.BUSY)));
        when(presenceStore.find("D-3")).thenReturn(Optional.of(presence("D-3", DriverPresence.ONLINE)));
        when(locationStore.position("D-1")).thenReturn(Optional.of(position(now)));
        when(locationStore.position("D-3")).thenReturn(Optional.of(
                position(now.minusSeconds(properties.getStaleAfter().toSeconds() + 120))));

        FleetService.CandidateList list = service.candidates(43.2389d, 76.8897d, 3_000, 5);

        assertThat(list.candidates()).extracting(FleetService.Candidate::driverId).containsExactly("D-1");
        assertThat(list.candidates().get(0).distanceM()).isEqualTo(120d);
        assertThat(list.radiusM()).isEqualTo(3_000);
        assertThat(list.generatedAt()).isNotNull();
    }

    @Test
    @DisplayName("a missing radius means the configured default, an oversized one is refused")
    void candidates_validate_radius() {
        Instant now = Instant.now();
        when(presenceStore.onDutyIds()).thenReturn(Set.of("D-1"));
        when(locationStore.nearest(anyDouble(), anyDouble(), anyInt(), anyInt())).thenReturn(List.of(nearby("D-1", 100d)));
        when(presenceStore.find("D-1")).thenReturn(Optional.of(presence("D-1", DriverPresence.ONLINE)));
        when(locationStore.position("D-1")).thenReturn(Optional.of(position(now)));

        // A caller that does not care about the radius must not have to know it.
        assertThat(service.candidates(43.2389d, 76.8897d, 0, 5).radiusM())
                .isEqualTo(properties.getDefaultRadiusM());

        assertThatThrownBy(() -> service.candidates(43.2389d, 76.8897d, properties.getMaxRadiusM() + 1, 5))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.INVALID_RADIUS));
    }

    @Test
    @DisplayName("the limit is enforced even when the index returns more")
    void candidates_respect_limit() {
        Instant now = Instant.now();
        when(presenceStore.onDutyIds()).thenReturn(Set.of("D-1", "D-2"));
        when(locationStore.nearest(anyDouble(), anyDouble(), anyInt(), anyInt())).thenReturn(List.of(
                nearby("D-1", 100d),
                nearby("D-2", 200d)));
        when(presenceStore.find("D-1")).thenReturn(Optional.of(presence("D-1", DriverPresence.ONLINE)));
        when(locationStore.position("D-1")).thenReturn(Optional.of(position(now)));

        // The second driver is never looked at: the limit stops the loop, so the
        // request costs one presence lookup instead of one per car in the radius.
        assertThat(service.candidates(43.2389d, 76.8897d, 3_000, 1).candidates()).hasSize(1);
        verify(locationStore).nearest(eq(43.2389d), eq(76.8897d), eq(3_000), anyInt());
    }
}
