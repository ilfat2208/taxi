package kz.taxi.driver.domain;

import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The duty state machine.
 *
 * <p>These tests are the specification dispatch relies on: only an {@code ONLINE}
 * driver may be offered a trip, and nobody becomes {@code ONLINE} without current
 * papers.
 */
class DriverTest {

    private static final Instant NOW = Instant.parse("2026-10-02T09:00:00Z");

    private static Driver newDriver() {
        return Driver.register("U-1", "+77001234567", "Айша", NOW);
    }

    private static List<DriverDocument> validDocuments() {
        return List.of(
                DriverDocument.issue("D-1", DocumentKind.DRIVING_LICENCE, NOW.plus(Duration.ofDays(300)), NOW),
                DriverDocument.issue("D-1", DocumentKind.VEHICLE_INSPECTION, NOW.plus(Duration.ofDays(90)), NOW),
                DriverDocument.issue("D-1", DocumentKind.MEDICAL_CHECK, NOW.plus(Duration.ofHours(8)), NOW));
    }

    private static Driver onDuty() {
        Driver driver = newDriver();
        driver.goOnDuty(validDocuments(), NOW);
        return driver;
    }

    // ------------------------------------------------------------------ registration

    @Test
    @DisplayName("a new driver starts off duty with a full rating and no trips")
    void registers_off_duty() {
        Driver driver = newDriver();

        assertThat(driver.getId()).hasSize(26);
        assertThat(driver.getStatus()).isEqualTo(DriverStatus.OFFLINE);
        assertThat(driver.isOnDuty()).isFalse();
        assertThat(driver.isAvailable()).isFalse();
        assertThat(driver.getRatingBp()).isEqualTo(Driver.INITIAL_RATING_BP);
        assertThat(driver.getCompletedTrips()).isZero();
        assertThat(driver.getCurrentTripId()).isNull();
    }

    @Test
    @DisplayName("a profile without a user or a phone is refused")
    void refuses_invalid_registration() {
        assertThatThrownBy(() -> Driver.register(" ", "+77001234567", "Айша", NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.INVALID_DRIVER));
        assertThatThrownBy(() -> Driver.register("U-1", null, "Айша", NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.INVALID_DRIVER));
    }

    @Test
    @DisplayName("a driver without a name is shown by his phone number")
    void falls_back_to_phone_as_display_name() {
        assertThat(Driver.register("U-1", "+77001234567", "  ", NOW).getDisplayName())
                .isEqualTo("+77001234567");
    }

    // ------------------------------------------------------------------ duty

    @Test
    @DisplayName("no duty without a single document on file")
    void refuses_duty_without_documents() {
        Driver driver = newDriver();

        assertThatThrownBy(() -> driver.goOnDuty(List.of(), NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_DOCUMENTS_INCOMPLETE));
        assertThat(driver.getStatus()).isEqualTo(DriverStatus.OFFLINE);
    }

    @Test
    @DisplayName("no duty when one required document is missing")
    void refuses_duty_with_missing_document() {
        List<DriverDocument> withoutMedicalCheck = List.of(
                DriverDocument.issue("D-1", DocumentKind.DRIVING_LICENCE, NOW.plus(Duration.ofDays(300)), NOW),
                DriverDocument.issue("D-1", DocumentKind.VEHICLE_INSPECTION, NOW.plus(Duration.ofDays(90)), NOW));

        assertThatThrownBy(() -> newDriver().goOnDuty(withoutMedicalCheck, NOW))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_DOCUMENTS_INCOMPLETE);
                    assertThat(ex.details()).containsEntry("missing", "MEDICAL_CHECK");
                });
    }

    @Test
    @DisplayName("no duty when a required document has expired")
    void refuses_duty_with_expired_document() {
        List<DriverDocument> expired = List.of(
                DriverDocument.issue("D-1", DocumentKind.DRIVING_LICENCE, NOW.plus(Duration.ofDays(300)), NOW),
                DriverDocument.issue("D-1", DocumentKind.VEHICLE_INSPECTION, NOW.plus(Duration.ofDays(90)), NOW),
                DriverDocument.issue("D-1", DocumentKind.MEDICAL_CHECK, NOW.minus(Duration.ofHours(1)), NOW));

        assertThatThrownBy(() -> newDriver().goOnDuty(expired, NOW))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_DOCUMENT_EXPIRED);
                    assertThat(ex.details()).containsEntry("kind", "MEDICAL_CHECK");
                });
    }

    @Test
    @DisplayName("a document that expires exactly now is already useless")
    void document_expiring_now_is_invalid() {
        DriverDocument document = DriverDocument.issue(
                "D-1", DocumentKind.MEDICAL_CHECK, NOW, NOW);

        assertThat(document.isValidAt(NOW)).isFalse();
        assertThat(document.isValidAt(NOW.minus(Duration.ofSeconds(1)))).isTrue();
    }

    @Test
    @DisplayName("going on duty makes the driver available to dispatch")
    void goes_on_duty() {
        Driver driver = newDriver();

        driver.goOnDuty(validDocuments(), NOW);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.ONLINE);
        assertThat(driver.isOnDuty()).isTrue();
        assertThat(driver.isAvailable()).isTrue();
        assertThat(driver.getUpdatedAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("going on duty twice is refused")
    void refuses_double_duty() {
        Driver driver = onDuty();

        assertThatThrownBy(() -> driver.goOnDuty(validDocuments(), NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_ALREADY_ON_DUTY));
    }

    @Test
    @DisplayName("going off duty returns the driver to offline")
    void goes_off_duty() {
        Driver driver = onDuty();

        driver.goOffDuty(NOW);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.OFFLINE);
        assertThat(driver.isOnDuty()).isFalse();
    }

    // ------------------------------------------------------------------ trips

    @Test
    @DisplayName("claiming a driver for a trip makes him busy and unavailable")
    void assigns_trip() {
        Driver driver = onDuty();

        driver.assignTrip("T-1", NOW);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.BUSY);
        assertThat(driver.isOnDuty()).isTrue();
        assertThat(driver.isAvailable()).isFalse();
        assertThat(driver.getCurrentTripId()).isEqualTo("T-1");
    }

    @Test
    @DisplayName("an off-duty driver cannot be claimed for a trip")
    void refuses_trip_when_off_duty() {
        Driver driver = newDriver();

        assertThatThrownBy(() -> driver.assignTrip("T-1", NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_NOT_ON_DUTY));
    }

    @Test
    @DisplayName("a driver cannot be claimed twice")
    void refuses_second_trip() {
        Driver driver = onDuty();
        driver.assignTrip("T-1", NOW);

        assertThatThrownBy(() -> driver.assignTrip("T-2", NOW))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_ALREADY_ON_TRIP);
                    assertThat(ex.details()).containsEntry("tripId", "T-1");
                });
    }

    @Test
    @DisplayName("finishing a trip returns the driver to duty and counts the trip")
    void finishes_trip() {
        Driver driver = onDuty();
        driver.assignTrip("T-1", NOW);

        driver.finishTrip(NOW);

        assertThat(driver.getStatus()).isEqualTo(DriverStatus.ONLINE);
        assertThat(driver.getCurrentTripId()).isNull();
        assertThat(driver.getCompletedTrips()).isEqualTo(1);
        assertThat(driver.isAvailable()).isTrue();
    }

    @Test
    @DisplayName("finishing without a trip is refused")
    void refuses_finish_without_trip() {
        Driver driver = onDuty();

        assertThatThrownBy(() -> driver.finishTrip(NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_HAS_NO_TRIP));
    }

    @Test
    @DisplayName("a driver cannot go off duty with a rider in the car")
    void refuses_off_duty_during_trip() {
        Driver driver = onDuty();
        driver.assignTrip("T-1", NOW);

        assertThatThrownBy(() -> driver.goOffDuty(NOW))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(DriverErrorCode.DRIVER_ON_TRIP));
    }
}
