package kz.taxi.driver.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * A driver profile and his duty state.
 *
 * <p>The interesting part is not the fields but the transitions. Dispatch asks
 * "may I offer this driver a trip?" thousands of times a minute, so the answer
 * must be a state machine the database can also enforce, not a convention:
 *
 * <pre>
 *   OFFLINE --goOnDuty(documents valid)--&gt; ONLINE
 *   ONLINE  --assignTrip------------------&gt; BUSY
 *   BUSY    --finishTrip------------------&gt; ONLINE
 *   ONLINE  --goOffDuty-------------------&gt; OFFLINE
 * </pre>
 *
 * <p>Going on duty requires current documents, and going off duty is impossible
 * with a rider in the car — both rules live here, in one place, because a second
 * implementation of them will eventually disagree with this one.
 */
@Entity
@Table(name = "driver")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Driver {

    /** A brand-new driver starts at 5.00; ratings are basis points, never doubles. */
    public static final int MAX_RATING_BP = 50_000;
    public static final int INITIAL_RATING_BP = 50_000;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "user_id", length = 64, nullable = false, updatable = false)
    private String userId;

    @Column(name = "phone", length = 32, nullable = false)
    private String phone;

    @Column(name = "display_name", length = 128, nullable = false)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private DriverStatus status;

    /** Rating in basis points: 50_000 is 5.00. Integers, because money-adjacent math is never float. */
    @Column(name = "rating_bp", nullable = false)
    private int ratingBp;

    @Column(name = "completed_trips", nullable = false)
    private int completedTrips;

    @Column(name = "current_trip_id", length = 26)
    private String currentTripId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Registers a driver. He starts off duty: going on duty is an explicit act. */
    public static Driver register(String userId, String phone, String displayName, Instant now) {
        if (userId == null || userId.isBlank()) {
            throw DomainException.of(DriverErrorCode.INVALID_DRIVER, "userId is required");
        }
        if (phone == null || phone.isBlank()) {
            throw DomainException.of(DriverErrorCode.INVALID_DRIVER, "phone is required");
        }
        Driver driver = new Driver();
        driver.id = Ulid.nextId();
        driver.userId = userId;
        driver.phone = phone;
        driver.displayName = displayName == null || displayName.isBlank() ? phone : displayName;
        driver.status = DriverStatus.OFFLINE;
        driver.ratingBp = INITIAL_RATING_BP;
        driver.completedTrips = 0;
        driver.createdAt = now;
        driver.updatedAt = now;
        return driver;
    }

    // ------------------------------------------------------------------ duty

    /**
     * Goes on duty, if the papers are in order.
     *
     * <p>Checked here rather than in the controller because this is the rule the
     * platform is accountable for: an uninsured car or an expired medical check
     * must not be able to receive a rider, whatever the client app believes.
     */
    public void goOnDuty(java.util.List<DriverDocument> documents, Instant now) {
        if (status != DriverStatus.OFFLINE) {
            throw DomainException.of(DriverErrorCode.DRIVER_ALREADY_ON_DUTY,
                            "driver {} is already {}", id, status)
                    .withDetail("status", status.name());
        }
        DriverDuty.requireDutyReady(documents, now);
        this.status = DriverStatus.ONLINE;
        this.updatedAt = now;
    }

    /** Goes off duty. Refused mid-trip: the rider is already in the car. */
    public void goOffDuty(Instant now) {
        if (currentTripId != null) {
            throw DomainException.of(DriverErrorCode.DRIVER_ON_TRIP,
                            "driver {} cannot go off duty during trip {}", id, currentTripId)
                    .withDetail("tripId", currentTripId);
        }
        this.status = DriverStatus.OFFLINE;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ trips

    /** Claims this driver for a trip. This is the step that makes him unavailable to dispatch. */
    public void assignTrip(String tripId, Instant now) {
        if (tripId == null || tripId.isBlank()) {
            throw DomainException.of(DriverErrorCode.INVALID_DRIVER, "tripId is required");
        }
        if (currentTripId != null) {
            throw DomainException.of(DriverErrorCode.DRIVER_ALREADY_ON_TRIP,
                            "driver {} already performs trip {}", id, currentTripId)
                    .withDetail("tripId", currentTripId);
        }
        if (status != DriverStatus.ONLINE) {
            throw DomainException.of(DriverErrorCode.DRIVER_NOT_ON_DUTY,
                            "driver {} is {} and cannot take a trip", id, status)
                    .withDetail("status", status.name());
        }
        this.currentTripId = tripId;
        this.status = DriverStatus.BUSY;
        this.updatedAt = now;
    }

    /**
     * Releases the driver after the trip.
     *
     * <p>He returns to {@link DriverStatus#ONLINE}, not to {@code OFFLINE}: a
     * driver who just finished a ride is by definition still working, and forcing
     * him to toggle duty again after every trip would be a product bug.
     */
    public void finishTrip(Instant now) {
        if (currentTripId == null) {
            throw DomainException.of(DriverErrorCode.DRIVER_HAS_NO_TRIP,
                    "driver {} has no active trip", id);
        }
        this.currentTripId = null;
        this.completedTrips = this.completedTrips + 1;
        this.status = DriverStatus.ONLINE;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ queries

    /** On duty in any sense: online or busy. */
    public boolean isOnDuty() {
        return status != DriverStatus.OFFLINE;
    }

    /** The only state dispatch may offer a trip to. */
    public boolean isAvailable() {
        return status == DriverStatus.ONLINE && currentTripId == null;
    }
}
