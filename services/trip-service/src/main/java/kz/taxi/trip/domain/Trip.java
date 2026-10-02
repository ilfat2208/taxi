package kz.taxi.trip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One ride, from the request to the rating.
 *
 * <p>The aggregate owns three things that must never disagree with each other, which
 * is exactly why they live in one class and one row:
 *
 * <ol>
 *   <li><b>the ride</b> — who, where, which driver, which tariff;</li>
 *   <li><b>the money</b> — the price agreed in the quote, the platform's commission,
 *       what is left for the driver, and the hold that carries it. The price is copied
 *       from the quote at creation and never recomputed: a tariff change at 23:59 must
 *       not re-price a ride that started at 23:58;</li>
 *   <li><b>the state machine</b> — which moves are possible, which are refused, and
 *       what each move timestamps.</li>
 * </ol>
 *
 * <p>The invariant {@code driverNetMinor + commissionMinor == priceMinor} is true by
 * construction ({@link FareCalculator} derives the driver's share by subtraction) and
 * is additionally enforced by a database CHECK constraint. The code should be the
 * reason it holds; the constraint is there so that a future refactor that breaks it
 * fails loudly instead of paying a driver the wrong amount.
 *
 * <p><strong>Explicitly deferred to a later phase:</strong> the driver's
 * {@code driverNetMinor} is computed and stored, but nobody pays it out. The rider's
 * fare is captured into the platform suspense account, and turning that into a driver
 * wallet, an incentive, a cash-collection offset and a payout run is a separate step
 * with its own ledger design. The number is kept here now because it is a fact of the
 * ride (the rider's price, the platform's cut, the driver's earnings), and recomputing
 * it later from a changed commission rate would be wrong.
 */
@Entity
@Table(name = "trip")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Trip {

    /** A rating is 1..5 stars; the scale is a product decision, enforced here. */
    public static final int MIN_STARS = 1;
    public static final int MAX_STARS = 5;

    private static final int REASON_LENGTH = 512;
    private static final int COMMENT_LENGTH = 512;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "trip_number", length = 32, nullable = false, updatable = false)
    private String tripNumber;

    @Column(name = "idempotency_key", length = 128, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "quote_id", length = 26, nullable = false, updatable = false)
    private String quoteId;

    @Column(name = "rider_user_id", length = 64, nullable = false, updatable = false)
    private String riderUserId;

    /** The wallet the fare is reserved on; resolved once, at assignment. */
    @Column(name = "rider_account_id", length = 26)
    private String riderAccountId;

    @Column(name = "driver_id", length = 26)
    private String driverId;

    /** Snapshot of the driver's name: support reads a trip years later, the profile may be gone. */
    @Column(name = "driver_name", length = 128)
    private String driverName;

    /**
     * Plate of the car that performed the ride.
     *
     * <p>Null in Ф2: the vehicle profile (and its plate) is not part of driver-service
     * yet. The column exists now because the rider's screen shows it as soon as a
     * driver is assigned, and because filling it later must not be a migration.
     */
    @Column(name = "vehicle_plate", length = 16)
    private String vehiclePlate;

    @Enumerated(EnumType.STRING)
    @Column(name = "tariff", length = 16, nullable = false, updatable = false)
    private Tariff tariff;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 24, nullable = false)
    private TripStatus status;

    @Column(name = "pickup_lat", nullable = false, updatable = false)
    private double pickupLat;

    @Column(name = "pickup_lon", nullable = false, updatable = false)
    private double pickupLon;

    @Column(name = "pickup_address", length = 256)
    private String pickupAddress;

    @Column(name = "dropoff_lat", nullable = false, updatable = false)
    private double dropoffLat;

    @Column(name = "dropoff_lon", nullable = false, updatable = false)
    private double dropoffLon;

    @Column(name = "dropoff_address", length = 256)
    private String dropoffAddress;

    @Column(name = "distance_m", nullable = false, updatable = false)
    private int distanceM;

    @Column(name = "duration_s", nullable = false, updatable = false)
    private int durationS;

    @Column(name = "price_minor", nullable = false, updatable = false)
    private long priceMinor;

    @Column(name = "commission_minor", nullable = false, updatable = false)
    private long commissionMinor;

    @Column(name = "driver_net_minor", nullable = false, updatable = false)
    private long driverNetMinor;

    @Column(name = "base_minor", nullable = false, updatable = false)
    private long baseMinor;

    @Column(name = "distance_minor", nullable = false, updatable = false)
    private long distanceMinor;

    @Column(name = "time_minor", nullable = false, updatable = false)
    private long timeMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "surge_bp", nullable = false, updatable = false)
    private int surgeBp;

    @Column(name = "commission_bp", nullable = false, updatable = false)
    private int commissionBp;

    @Column(name = "hold_id", length = 26)
    private String holdId;

    @Enumerated(EnumType.STRING)
    @Column(name = "hold_status", length = 16, nullable = false)
    private TripHoldStatus holdStatus = TripHoldStatus.NONE;

    /** Ledger transaction of the capture; how support finds the money movement. */
    @Column(name = "capture_transaction_id", length = 26)
    private String captureTransactionId;

    @Column(name = "cancel_reason", length = REASON_LENGTH)
    private String cancelReason;

    @Column(name = "rating_stars")
    private Integer ratingStars;

    @Column(name = "rating_comment", length = COMMENT_LENGTH)
    private String ratingComment;

    @Column(name = "rated_at")
    private Instant ratedAt;

    @Column(name = "comment", length = COMMENT_LENGTH)
    private String comment;

    @Column(name = "requested_at", nullable = false, updatable = false)
    private Instant requestedAt;

    @Column(name = "assigned_at")
    private Instant assignedAt;

    @Column(name = "arrived_at")
    private Instant arrivedAt;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /**
     * Creates the trip from an already-validated quote.
     *
     * <p>Everything about the price is copied, not referenced: the quote row may be
     * purged by a retention job, and a receipt that depends on a row that no longer
     * exists is not a receipt. The {@code idempotencyKey} is stored with a unique index
     * on top of the API's idempotency store, so a retried request that gets past the
     * store (a flushed Redis, a second replica) still cannot create a second trip.
     */
    public static Trip request(String riderUserId,
                               Quote quote,
                               String idempotencyKey,
                               String comment,
                               Instant now) {
        if (riderUserId == null || riderUserId.isBlank()) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST, "riderUserId is required");
        }
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST, "an idempotency key is required");
        }
        Trip trip = new Trip();
        trip.id = Ulid.nextId();
        trip.tripNumber = TripNumber.next();
        trip.idempotencyKey = idempotencyKey;
        trip.quoteId = quote.getId();
        trip.riderUserId = riderUserId;
        trip.riderAccountId = quote.getRiderAccountId();
        trip.tariff = quote.getTariff();
        trip.status = TripStatus.SEARCHING;
        trip.pickupLat = quote.getPickupLat();
        trip.pickupLon = quote.getPickupLon();
        trip.pickupAddress = quote.getPickupAddress();
        trip.dropoffLat = quote.getDropoffLat();
        trip.dropoffLon = quote.getDropoffLon();
        trip.dropoffAddress = quote.getDropoffAddress();
        trip.distanceM = quote.getDistanceM();
        trip.durationS = quote.getDurationS();
        trip.priceMinor = quote.getPriceMinor();
        trip.commissionMinor = quote.getCommissionMinor();
        trip.driverNetMinor = quote.getDriverNetMinor();
        trip.baseMinor = quote.getBaseMinor();
        trip.distanceMinor = quote.getDistanceMinor();
        trip.timeMinor = quote.getTimeMinor();
        trip.currency = quote.getCurrency();
        trip.surgeBp = quote.getSurgeBp();
        trip.commissionBp = quote.getCommissionBp();
        trip.comment = truncate(comment);
        trip.requestedAt = now;
        trip.updatedAt = now;
        return trip;
    }

    // ------------------------------------------------------------------ money

    /** Remembers which wallet the fare is reserved on, before anything is reserved. */
    public void attachRiderAccount(String accountId) {
        if (accountId == null || accountId.isBlank()) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST, "accountId is required");
        }
        this.riderAccountId = accountId;
    }

    /**
     * Records the hold placed on the rider's account.
     *
     * <p>Written before the driver is claimed, not after: if the process dies between
     * the two, the trip is the only place that knows a hold exists, and a retry that
     * cannot see it would reserve the fare a second time.
     */
    public void attachHold(String holdId) {
        if (holdId == null || holdId.isBlank()) {
            throw DomainException.of(TripErrorCode.HOLD_FAILED, "a hold id is required to record a reservation");
        }
        if (this.holdId != null && !this.holdId.equals(holdId)) {
            throw DomainException.of(TripErrorCode.HOLD_FAILED,
                            "trip {} already holds fare under hold {}, refusing {}", id, this.holdId, holdId)
                    .withDetail("tripId", id)
                    .withDetail("holdId", this.holdId);
        }
        this.holdId = holdId;
        this.holdStatus = TripHoldStatus.ACTIVE;
    }

    /** Marks the reservation as spent. Only a completed ride may do this. */
    public void markHoldCaptured(String transactionId) {
        if (holdStatus != TripHoldStatus.ACTIVE) {
            throw DomainException.of(TripErrorCode.CAPTURE_FAILED,
                            "trip {} has no active reservation to capture (hold status {})", id, holdStatus)
                    .withDetail("tripId", id)
                    .withDetail("holdStatus", holdStatus.name());
        }
        this.holdStatus = TripHoldStatus.CAPTURED;
        this.captureTransactionId = transactionId;
    }

    /** Marks the reservation as returned to the rider. Idempotent by status. */
    public void markHoldReleased() {
        if (holdStatus == TripHoldStatus.ACTIVE) {
            this.holdStatus = TripHoldStatus.RELEASED;
        }
    }

    /** True while money is reserved and not yet moved. */
    public boolean hasActiveHold() {
        return holdStatus == TripHoldStatus.ACTIVE && holdId != null;
    }

    // ------------------------------------------------------------------ lifecycle

    /**
     * A driver is claimed and the fare is reserved: the ride exists.
     *
     * <p>Refuses a second driver explicitly. "Assign again" is a legitimate retry of
     * the same request, but it must be recognised as one — assigning a second car to a
     * trip that already has one is how two drivers end up at the same door.
     */
    public void markAssigned(String driverId, String driverName, String vehiclePlate, Instant now) {
        if (driverId == null || driverId.isBlank()) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST, "driverId is required");
        }
        if (this.driverId != null) {
            if (!this.driverId.equals(driverId)) {
                throw DomainException.of(TripErrorCode.TRIP_NOT_ASSIGNABLE,
                                "trip {} already belongs to driver {}", id, this.driverId)
                        .withDetail("tripId", id)
                        .withDetail("driverId", this.driverId);
            }
            // The same driver on the same ride is a retried call, not a second transition:
            // there is nothing to move, and refusing it would make a client that retried
            // after a timeout believe the assignment failed.
            if (driverName != null && !driverName.isBlank()) {
                this.driverName = driverName;
            }
            if (vehiclePlate != null && !vehiclePlate.isBlank()) {
                this.vehiclePlate = vehiclePlate;
            }
            return;
        }
        moveTo(TripStatus.ASSIGNED, now);
        this.driverId = driverId;
        this.driverName = driverName;
        this.vehiclePlate = vehiclePlate;
    }

    /**
     * Closes the request because no car was available.
     *
     * <p>Not an error and not a cancellation by anybody: the platform looked and there
     * was nothing to offer. It is a state of the trip, so the rider can see that his
     * request was answered, and so the search can be retried as a new trip rather than
     * by resurrecting this one.
     */
    public void markNoDriversFound(Instant now) {
        moveTo(TripStatus.NO_DRIVERS_FOUND, now);
    }

    /** The car is at the pickup point. */
    public void markArrived(Instant now) {
        moveTo(TripStatus.ARRIVED, now);
    }

    /** The rider is in the car. After this the fare is owed. */
    public void markStarted(Instant now) {
        moveTo(TripStatus.IN_PROGRESS, now);
    }

    /** The ride happened; the fare has been captured. */
    public void markCompleted(String transactionId, Instant now) {
        moveTo(TripStatus.COMPLETED, now);
        this.captureTransactionId = transactionId == null ? this.captureTransactionId : transactionId;
    }

    /**
     * Calls the trip off.
     *
     * <p>Two rules, both enforced here rather than by the callers:
     * <ul>
     *   <li>only a pre-ride trip may be cancelled — once the rider is in the car the
     *       fare is owed, and an incident is a support case, not a status change;</li>
     *   <li>the cancellation must say whose side it came from, because the reason
     *       matters for the rider's experience ("водитель не смог приехать" is not
     *       "вы отменили") and for driver quality metrics.</li>
     * </ul>
     */
    public void cancel(TripStatus target, String reason, Instant now) {
        if (target == null || !target.isCancelled()) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_TRANSITION,
                            "{} is not a cancellation status", target)
                    .withDetail("status", target == null ? null : target.name());
        }
        if (!status.isCancellable()) {
            throw DomainException.of(TripErrorCode.TRIP_NOT_CANCELLABLE,
                            "trip {} is {} and can no longer be cancelled", id, status)
                    .withDetail("tripId", id)
                    .withDetail("status", status.name());
        }
        moveTo(target, now);
        this.cancelReason = truncate(reason);
    }

    /**
     * Records the rider's rating of the ride.
     *
     * <p>Only a performed trip can be rated, and only once: a rating is an opinion
     * about a specific ride, so the second one is a conflict rather than an update.
     * (Changing one's mind about a star is a product question for a later phase; it is
     * not solved here by silently overwriting the first answer.)
     */
    public void rate(int stars, String comment, Instant now) {
        if (stars < MIN_STARS || stars > MAX_STARS) {
            throw DomainException.of(TripErrorCode.INVALID_RATING,
                            "rating {} is outside {}..{}", stars, MIN_STARS, MAX_STARS)
                    .withDetail("stars", stars);
        }
        if (!status.isRateable()) {
            throw DomainException.of(TripErrorCode.TRIP_NOT_COMPLETED,
                            "trip {} is {} — only a completed trip can be rated", id, status)
                    .withDetail("tripId", id)
                    .withDetail("status", status.name());
        }
        if (ratedAt != null) {
            throw DomainException.of(TripErrorCode.TRIP_ALREADY_RATED,
                            "trip {} was already rated at {}", id, ratedAt)
                    .withDetail("tripId", id)
                    .withDetail("ratedAt", ratedAt.toString());
        }
        this.ratingStars = stars;
        this.ratingComment = truncate(comment);
        this.ratedAt = now;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ queries

    /** True when the trip is still being searched for a driver. */
    public boolean isOpen() {
        return !status.isTerminal();
    }

    // ------------------------------------------------------------------ internals

    /**
     * The one place a status changes.
     *
     * <p>Every public move goes through here, which is what makes "forward only" a
     * property of the class instead of a habit of its callers — and what keeps every
     * timestamp in step with the status that produced it.
     */
    private void moveTo(TripStatus target, Instant now) {
        if (!status.canMoveTo(target)) {
            throw DomainException.of(TripErrorCode.INVALID_TRIP_TRANSITION,
                            "trip {} cannot move from {} to {}", id, status, target)
                    .withDetail("tripId", id)
                    .withDetail("from", status.name())
                    .withDetail("to", target.name());
        }
        this.status = target;
        this.updatedAt = now;
        switch (target) {
            case ASSIGNED -> this.assignedAt = now;
            case ARRIVED -> this.arrivedAt = now;
            case IN_PROGRESS -> this.startedAt = now;
            case COMPLETED -> this.completedAt = now;
            // NO_DRIVERS_FOUND closes the request the way a cancellation does: the
            // rider needs one "when was this over" instant, not two fields that mean
            // almost the same thing.
            case CANCELLED_BY_RIDER, CANCELLED_BY_DRIVER, NO_DRIVERS_FOUND -> this.cancelledAt = now;
            case SEARCHING -> throw new IllegalStateException("SEARCHING is the initial status and cannot be re-entered");
        }
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= COMMENT_LENGTH ? value : value.substring(0, COMMENT_LENGTH);
    }
}
