package kz.taxi.qtime.domain;

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
import kz.taxi.common.core.money.Money;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Duration;
import java.time.Instant;

/**
 * An appointment: one client, one specialist, one window.
 *
 * <p>The aggregate is where "одно окно — одна запись" is decided, and it is decided
 * twice on purpose. Here, as a state machine that refuses a transition that makes no
 * sense (a completed visit cannot be cancelled, a cancellation needs a reason and a
 * time). In the database, as a partial unique index over {@code (specialist_id,
 * starts_at) where status = 'CONFIRMED'} — because two clients tapping the same
 * 15:30 pass every check this class can make and still collide.
 *
 * <p><b>What is stored is a snapshot, not a reference.</b> {@link #durationMinutes},
 * {@link #priceMinor} and {@link #currency} are copied from the {@link ServiceItem} at
 * booking time. A receipt must show what the client was quoted, and re-pricing
 * "маникюр" next quarter must not silently rewrite what somebody agreed to in March.
 * The ids stay next to the snapshot so the booking still points at the live entities.
 *
 * <p>Interval safety for two bookings that start at *different* times rests on the
 * caller: the application service validates the requested window against the existing
 * intervals and serializes bookings of one specialist with a row lock, since a plain
 * unique index cannot express "these two ranges must not overlap" (that would need
 * {@code btree_gist}; see the migration for why the deployment is not asked for it).
 */
@Entity
@Table(name = "booking")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Booking {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    /** Human-readable code derived from the id; unique, and meant to be read out loud. */
    @Column(name = "code", length = 16, nullable = false, updatable = false)
    private String code;

    /** Owner. Roles never appear here: a booking belongs to a person, not to a token. */
    @Column(name = "client_user_id", length = 64, nullable = false, updatable = false)
    private String clientUserId;

    @Column(name = "company_id", length = 26, nullable = false, updatable = false)
    private String companyId;

    @Column(name = "specialist_id", length = 26, nullable = false, updatable = false)
    private String specialistId;

    @Column(name = "service_id", length = 26, nullable = false, updatable = false)
    private String serviceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 24, nullable = false)
    private BookingStatus status;

    @Column(name = "starts_at", nullable = false, updatable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false, updatable = false)
    private Instant endsAt;

    /** Snapshot of the service duration: the window length the client agreed to. */
    @Column(name = "duration_minutes", nullable = false, updatable = false)
    private int durationMinutes;

    /** Snapshot of the price in minor units (tiyn for KZT). */
    @Column(name = "price_minor", nullable = false)
    private long priceMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 8, nullable = false)
    private Currency currency;

    /** "Протекает смеситель, домофон 45" — what the specialist needs before arriving. */
    @Column(name = "client_comment", length = 500)
    private String clientComment;

    @Column(name = "cancel_reason", length = 255)
    private String cancelReason;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /**
     * Takes the window: the only way a booking comes into existence is CONFIRMED.
     *
     * <p>The caller has already established that the window is inside working hours
     * and free (that needs the calendar, which this aggregate does not hold); what is
     * checked here is that the booking itself is coherent — an owner, a positive
     * duration, a price that is not negative, and an interval that goes forward.
     */
    public static Booking confirm(String clientUserId, Company company, Specialist specialist,
                                  ServiceItem service, Instant startsAt, String comment, Instant now) {
        if (clientUserId == null || clientUserId.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_BOOKING, "clientUserId is required");
        }
        if (company == null || specialist == null || service == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_BOOKING,
                    "a booking needs a company, a specialist and a service");
        }
        if (!service.belongsToCompany(company.getId())) {
            throw DomainException.of(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST,
                            "service {} does not belong to company {}", service.getId(), company.getId())
                    .withDetail("serviceId", service.getId())
                    .withDetail("companyId", company.getId());
        }
        if (!service.offeredBy(specialist.getId())) {
            throw DomainException.of(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST,
                            "specialist {} does not provide service {}", specialist.getId(), service.getId())
                    .withDetail("serviceId", service.getId())
                    .withDetail("specialistId", specialist.getId());
        }
        if (!specialist.worksFor(company.getId())) {
            throw DomainException.of(QtimeErrorCode.INVALID_BOOKING,
                            "specialist {} does not work for company {}", specialist.getId(), company.getId())
                    .withDetail("specialistId", specialist.getId())
                    .withDetail("companyId", company.getId());
        }
        if (startsAt == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_BOOKING, "startsAt is required");
        }
        if (service.getDurationMinutes() <= 0) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE,
                    "service {} has no duration, so no window can be computed", service.getId());
        }

        Booking booking = new Booking();
        booking.id = Ulid.nextId();
        booking.code = BookingCode.of(booking.id);
        booking.clientUserId = clientUserId;
        booking.companyId = company.getId();
        booking.specialistId = specialist.getId();
        booking.serviceId = service.getId();
        booking.status = BookingStatus.CONFIRMED;
        booking.startsAt = startsAt;
        booking.endsAt = startsAt.plus(Duration.ofMinutes(service.getDurationMinutes()));
        booking.durationMinutes = service.getDurationMinutes();
        booking.priceMinor = service.getPriceMinor();
        booking.currency = service.getCurrency();
        booking.clientComment = comment == null || comment.isBlank() ? null : comment.trim();
        booking.createdAt = now;
        booking.updatedAt = now;
        return booking;
    }

    // ------------------------------------------------------------------ transitions

    /**
     * Releases the window.
     *
     * <p>Who cancelled is part of the fact, not a comment on it: "клиент передумал" and
     * "салон закрылся" are different numbers in a CRM, and a single CANCELLED status
     * would lose the distinction the moment somebody needs it.
     *
     * <p>Nothing is deleted: the row keeps its status, and because the unique index only
     * covers CONFIRMED, changing the status frees the slot by itself.
     */
    public void cancel(String reason, boolean byCompany, Instant now) {
        if (status != BookingStatus.CONFIRMED) {
            throw DomainException.of(QtimeErrorCode.BOOKING_NOT_CANCELLABLE,
                            "booking {} is {} and can no longer be cancelled", id, status)
                    .withDetail("status", status.name());
        }
        this.status = byCompany ? BookingStatus.CANCELLED_BY_COMPANY : BookingStatus.CANCELLED_BY_CLIENT;
        this.cancelReason = reason == null || reason.isBlank() ? null : reason.trim();
        this.cancelledAt = now;
        this.updatedAt = now;
    }

    /**
     * Marks the visit as done. Called by the company (internal API) once the work is
     * finished — the moment a review, a settlement or a next-visit reminder may follow.
     */
    public void complete(Instant now) {
        if (status != BookingStatus.CONFIRMED) {
            throw DomainException.of(QtimeErrorCode.BOOKING_NOT_COMPLETABLE,
                            "booking {} is {} and cannot be completed", id, status)
                    .withDetail("status", status.name());
        }
        this.status = BookingStatus.COMPLETED;
        this.updatedAt = now;
    }

    /**
     * The client never came.
     *
     * <p>No endpoint sets this yet — attendance is recorded by the company calendar in
     * ORTA Business (Ф2). It lives in the aggregate now because NO_SHOW is part of the
     * status model, and a status that cannot be reached is a status nobody can reason
     * about: the CRM's "неявки" report needs the transition to exist before the screen
     * that triggers it does.
     */
    public void markNoShow(Instant now) {
        if (status != BookingStatus.CONFIRMED) {
            throw DomainException.of(QtimeErrorCode.BOOKING_NOT_COMPLETABLE,
                            "booking {} is {} and cannot be marked as a no-show", id, status)
                    .withDetail("status", status.name());
        }
        this.status = BookingStatus.NO_SHOW;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ queries

    public Money price() {
        return Money.ofMinor(priceMinor, currency);
    }

    /** True while this booking still occupies its window. */
    public boolean occupiesSlot() {
        return status.occupiesSlot();
    }

    /** True when the caller is the owner of this booking. */
    public boolean belongsTo(String userId) {
        return clientUserId.equals(userId);
    }

    /** True when {@code [from, to)} intersects this booking's window (half-open). */
    public boolean overlaps(Instant from, Instant to) {
        return from.isBefore(endsAt) && startsAt.isBefore(to);
    }

    /** True when this booking occupies the window AND intersects {@code [from, to)}. */
    public boolean blocks(Instant from, Instant to) {
        return occupiesSlot() && overlaps(from, to);
    }
}
