package kz.taxi.dispatch.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.dispatch.domain.DispatchErrorCode;
import kz.taxi.dispatch.domain.DriverPosition;
import kz.taxi.dispatch.domain.DriverPresence;
import kz.taxi.dispatch.infrastructure.DispatchProperties;
import kz.taxi.dispatch.infrastructure.DriverLocationStore;
import kz.taxi.dispatch.infrastructure.FleetPresenceStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who may report a position, and what survives validation.
 */
@ExtendWith(MockitoExtension.class)
class LocationIngestServiceTest {

    private static final String USER_ID = "U-1";
    private static final String DRIVER_ID = "D-1";

    @Mock
    private FleetPresenceStore presenceStore;

    @Mock
    private DriverLocationStore locationStore;

    private DispatchProperties properties;
    private LocationIngestService service;

    @BeforeEach
    void setUp() {
        properties = new DispatchProperties();
        service = new LocationIngestService(presenceStore, locationStore, properties);
    }

    private static DriverPosition position(double lat, double lon, Instant at) {
        return DriverPosition.of(lat, lon, 90d, 30d, 8d, at);
    }

    private static DriverPresence presence(String status) {
        return new DriverPresence(DRIVER_ID, USER_ID, "Айдар", "+77001234567", status);
    }

    @Test
    @DisplayName("a user without a driver profile cannot report positions")
    void refuses_unknown_driver() {
        when(presenceStore.findByUserId(USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.record(USER_ID, List.of(position(43.2389, 76.8897, Instant.now()))))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.DRIVER_NOT_FOUND));
        verify(locationStore, never()).record(anyString(), any(DriverPosition.class));
    }

    @Test
    @DisplayName("an off-duty driver must not send positions")
    void refuses_off_duty_driver() {
        when(presenceStore.findByUserId(USER_ID)).thenReturn(Optional.of(presence(DriverPresence.OFFLINE)));

        assertThatThrownBy(() -> service.record(USER_ID, List.of(position(43.2389, 76.8897, Instant.now()))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.DRIVER_NOT_ON_DUTY);
                    assertThat(ex.details()).containsEntry("status", "OFFLINE");
                });
        verify(locationStore, never()).record(anyString(), any(DriverPosition.class));
    }

    @Test
    @DisplayName("a bad coordinate is refused, not stored")
    void refuses_invalid_position() {
        when(presenceStore.findByUserId(USER_ID)).thenReturn(Optional.of(presence(DriverPresence.ONLINE)));

        assertThatThrownBy(() -> service.record(USER_ID, List.of(position(91d, 76.8897d, Instant.now()))))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.INVALID_POSITION));
        assertThatThrownBy(() -> service.record(USER_ID, List.of(position(43.2389d, 181d, Instant.now()))))
                .isInstanceOf(DomainException.class);
        verify(locationStore, never()).record(anyString(), any(DriverPosition.class));
    }

    @Test
    @DisplayName("a batch larger than the limit is refused whole")
    void refuses_oversized_batch() {
        properties.setMaxBatchSize(2);

        assertThatThrownBy(() -> service.record(USER_ID, List.of(
                position(43.2389, 76.8897, Instant.now()),
                position(43.2390, 76.8898, Instant.now()),
                position(43.2391, 76.8899, Instant.now()))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.TOO_MANY_POINTS);
                    assertThat(ex.details()).containsEntry("points", 3);
                });
        // The batch is refused before anything is read or written: an oversized
        // request must not cost a Redis round trip.
        verify(locationStore, never()).record(anyString(), any(DriverPosition.class));
    }

    @Test
    @DisplayName("an empty batch is refused")
    void refuses_empty_batch() {
        assertThatThrownBy(() -> service.record(USER_ID, List.of()))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DispatchErrorCode.INVALID_POSITION));
    }

    @Test
    @DisplayName("only the newest reading of a batch reaches the index")
    void keeps_the_newest_point() {
        Instant old = Instant.now().minusSeconds(120);
        Instant fresh = Instant.now();
        when(presenceStore.findByUserId(USER_ID)).thenReturn(Optional.of(presence(DriverPresence.ONLINE)));

        LocationIngestService.IngestResult result = service.record(USER_ID, List.of(
                position(43.2300, 76.8800, old),
                position(43.2389, 76.8897, fresh)));

        ArgumentCaptor<DriverPosition> recorded = ArgumentCaptor.forClass(DriverPosition.class);
        verify(locationStore).record(org.mockito.ArgumentMatchers.eq(DRIVER_ID), recorded.capture());
        assertThat(recorded.getValue().at()).isEqualTo(fresh);
        assertThat(recorded.getValue().lat()).isEqualTo(43.2389);
        assertThat(result.accepted()).isEqualTo(2);
        assertThat(result.driverId()).isEqualTo(DRIVER_ID);
        assertThat(result.recordedAt()).isEqualTo(fresh);
    }
}
