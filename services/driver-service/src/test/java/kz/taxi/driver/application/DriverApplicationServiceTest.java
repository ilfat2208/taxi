package kz.taxi.driver.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.driver.domain.DocumentKind;
import kz.taxi.driver.domain.Driver;
import kz.taxi.driver.domain.DriverDocument;
import kz.taxi.driver.domain.DriverErrorCode;
import kz.taxi.driver.domain.DriverStatus;
import kz.taxi.driver.infrastructure.DriverDocumentRepository;
import kz.taxi.driver.infrastructure.DriverRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The use cases around a driver profile.
 *
 * <p>What is worth asserting here is not that fields get copied, but that the
 * service refuses what the domain refuses and that duty changes reach the topic —
 * dispatch learns about a driver going on duty from Kafka, and from nowhere else.
 */
@ExtendWith(MockitoExtension.class)
class DriverApplicationServiceTest {

    private static final String USER_ID = "U-1";
    private static final Instant NOW = Instant.parse("2026-10-02T09:00:00Z");

    @Mock
    private DriverRepository driverRepository;

    @Mock
    private DriverDocumentRepository documentRepository;

    @Mock
    private OutboxWriter outboxWriter;

    @InjectMocks
    private DriverApplicationService service;

    private static Driver driver() {
        return Driver.register(USER_ID, "+77001234567", "Айша", NOW);
    }

    private static List<DriverDocument> validDocuments(String driverId) {
        return List.of(
                DriverDocument.issue(driverId, DocumentKind.DRIVING_LICENCE, NOW.plus(Duration.ofDays(300)), NOW),
                DriverDocument.issue(driverId, DocumentKind.VEHICLE_INSPECTION, NOW.plus(Duration.ofDays(90)), NOW),
                DriverDocument.issue(driverId, DocumentKind.MEDICAL_CHECK, NOW.plus(Duration.ofDays(1)), NOW));
    }

    // ------------------------------------------------------------------ registration

    @Test
    @DisplayName("registration stores the profile and never touches duty")
    void registers_driver() {
        when(driverRepository.existsByUserId(USER_ID)).thenReturn(false);
        when(driverRepository.save(any(Driver.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Driver driver = service.register(USER_ID, "+77001234567", "Айша");

        assertThat(driver.getUserId()).isEqualTo(USER_ID);
        assertThat(driver.getStatus()).isEqualTo(DriverStatus.OFFLINE);
        verifyNoInteractions(outboxWriter);
    }

    @Test
    @DisplayName("a second profile for the same user is refused before anything is written")
    void refuses_duplicate_registration() {
        when(driverRepository.existsByUserId(USER_ID)).thenReturn(true);

        assertThatThrownBy(() -> service.register(USER_ID, "+77001234567", "Айша"))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_ALREADY_EXISTS));
        verify(driverRepository, never()).save(any(Driver.class));
    }

    @Test
    @DisplayName("an unknown user has no driver profile")
    void refuses_unknown_driver() {
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.requireByUserId(USER_ID))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_NOT_FOUND));
    }

    // ------------------------------------------------------------------ duty

    @Test
    @DisplayName("going on duty publishes driver.online for dispatch")
    void publishes_going_online() {
        Driver driver = driver();
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));
        when(documentRepository.findByDriverIdOrderByKindAsc(driver.getId()))
                .thenReturn(validDocuments(driver.getId()));

        service.changeStatus(USER_ID, DriverStatus.ONLINE);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.ONLINE);
        verify(outboxWriter).append(
                eq(KafkaTopics.DRIVER_EVENTS),
                eq(KafkaTopics.Events.DRIVER_ONLINE),
                eq("Driver"),
                eq(driver.getId()),
                anyLong(),
                any(DriverEvents.DutyChanged.class));
    }

    @Test
    @DisplayName("going off duty publishes driver.offline")
    void publishes_going_offline() {
        Driver driver = driver();
        driver.goOnDuty(validDocuments(driver.getId()), NOW);
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));

        service.changeStatus(USER_ID, DriverStatus.OFFLINE);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.OFFLINE);
        verify(outboxWriter).append(
                eq(KafkaTopics.DRIVER_EVENTS),
                eq(KafkaTopics.Events.DRIVER_OFFLINE),
                eq("Driver"),
                eq(driver.getId()),
                anyLong(),
                any(DriverEvents.DutyChanged.class));
    }

    @Test
    @DisplayName("repeating 'go offline' is harmless for the client and silent on the topic")
    void repeated_offline_publishes_nothing() {
        Driver driver = driver();
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));

        service.changeStatus(USER_ID, DriverStatus.OFFLINE);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.OFFLINE);
        verifyNoInteractions(outboxWriter);
    }

    @Test
    @DisplayName("a client cannot declare itself busy")
    void refuses_client_side_busy() {
        Driver driver = driver();
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));

        assertThatThrownBy(() -> service.changeStatus(USER_ID, DriverStatus.BUSY))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.INVALID_DRIVER);
                    assertThat(ex.details()).containsEntry("status", "BUSY");
                });
    }

    @Test
    @DisplayName("going on duty with an expired document never reaches the topic")
    void expired_documents_are_refused() {
        Driver driver = driver();
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));
        when(documentRepository.findByDriverIdOrderByKindAsc(driver.getId())).thenReturn(List.of(
                DriverDocument.issue(driver.getId(), DocumentKind.DRIVING_LICENCE, NOW.plus(Duration.ofDays(30)), NOW),
                DriverDocument.issue(driver.getId(), DocumentKind.VEHICLE_INSPECTION, NOW.plus(Duration.ofDays(30)), NOW),
                DriverDocument.issue(driver.getId(), DocumentKind.MEDICAL_CHECK, NOW.minus(Duration.ofDays(1)), NOW)));

        assertThatThrownBy(() -> service.changeStatus(USER_ID, DriverStatus.ONLINE))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_DOCUMENT_EXPIRED));
        verifyNoInteractions(outboxWriter);
    }

    // ------------------------------------------------------------------ documents

    @Test
    @DisplayName("submitting a document of a kind already on file renews it instead of adding a row")
    void renews_existing_document() {
        Driver driver = driver();
        DriverDocument existing = DriverDocument.issue(
                driver.getId(), DocumentKind.MEDICAL_CHECK, NOW.plus(Duration.ofDays(1)), NOW);
        Instant extended = NOW.plus(Duration.ofDays(30));
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));
        when(documentRepository.findByDriverIdAndKind(driver.getId(), DocumentKind.MEDICAL_CHECK))
                .thenReturn(Optional.of(existing));

        DriverDocument result = service.issueDocument(USER_ID, DocumentKind.MEDICAL_CHECK, extended);

        assertThat(result.getId()).isEqualTo(existing.getId());
        assertThat(result.getExpiresAt()).isEqualTo(extended);
        verify(documentRepository, never()).save(any(DriverDocument.class));
    }

    @Test
    @DisplayName("a new kind of document is stored")
    void stores_new_document() {
        Driver driver = driver();
        when(driverRepository.findByUserId(USER_ID)).thenReturn(Optional.of(driver));
        when(documentRepository.findByDriverIdAndKind(driver.getId(), DocumentKind.DRIVING_LICENCE))
                .thenReturn(Optional.empty());
        when(documentRepository.save(any(DriverDocument.class))).thenAnswer(invocation -> invocation.getArgument(0));

        DriverDocument result = service.issueDocument(USER_ID, DocumentKind.DRIVING_LICENCE, NOW.plus(Duration.ofDays(365)));

        assertThat(result.getDriverId()).isEqualTo(driver.getId());
        assertThat(result.getKind()).isEqualTo(DocumentKind.DRIVING_LICENCE);
    }

    // ------------------------------------------------------------------ trips

    @Test
    @DisplayName("claiming a driver for a trip makes him busy")
    void assigns_trip() {
        Driver driver = driver();
        driver.goOnDuty(validDocuments(driver.getId()), NOW);
        when(driverRepository.findById(driver.getId())).thenReturn(Optional.of(driver));

        service.assignTrip(driver.getId(), "T-1");

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.BUSY);
        assertThat(driver.getCurrentTripId()).isEqualTo("T-1");
    }

    @Test
    @DisplayName("finishing a trip returns the driver to duty and counts it")
    void finishes_trip() {
        Driver driver = driver();
        driver.goOnDuty(validDocuments(driver.getId()), NOW);
        driver.assignTrip("T-1", NOW);
        when(driverRepository.findById(driver.getId())).thenReturn(Optional.of(driver));

        service.finishTrip(driver.getId());

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.ONLINE);
        assertThat(driver.getCompletedTrips()).isEqualTo(1);
    }
}
