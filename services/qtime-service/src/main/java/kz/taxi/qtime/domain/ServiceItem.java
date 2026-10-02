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

import java.time.Instant;

/**
 * What is sold, and how long it takes.
 *
 * <p>{@link #durationMinutes} is the field the whole service is built around: free
 * windows are not "free half-hours", they are places where a service of this length
 * fits between two other services of their own lengths. A 90-minute manicure does
 * not fit in the 30 minutes before lunch, and no amount of UI can hide that.
 *
 * <p>{@link #specialistId} is nullable and means "any specialist of the company can
 * do it": a salon publishes "маникюр с покрытием" once, while "наращивание ресниц"
 * belongs to the one master who does it. Both answers to "может ли этот мастер
 * взяться за эту услугу" are expressed by {@link #offeredBy}, in one place.
 */
@Entity
@Table(name = "service_item")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ServiceItem {

    public static final int MIN_DURATION_MINUTES = 5;
    public static final int MAX_DURATION_MINUTES = 1_440;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "company_id", length = 26, nullable = false, updatable = false)
    private String companyId;

    /** {@code null} = offered by every specialist of the company. */
    @Column(name = "specialist_id", length = 26, updatable = false)
    private String specialistId;

    @Column(name = "name", length = 160, nullable = false)
    private String name;

    @Column(name = "duration_minutes", nullable = false)
    private int durationMinutes;

    /** Price in minor units (tiyn for KZT): integers, like every amount in the platform. */
    @Column(name = "price_minor", nullable = false)
    private long priceMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 8, nullable = false)
    private Currency currency;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Publishes an offer. A company-wide offer passes {@code specialistId == null}. */
    public static ServiceItem offer(String companyId, String specialistId, String name,
                                    int durationMinutes, Money price, Instant now) {
        if (companyId == null || companyId.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE, "companyId is required");
        }
        if (name == null || name.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE, "name is required");
        }
        if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE,
                    "duration {} is outside {}..{} minutes",
                    durationMinutes, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);
        }
        if (price == null || price.isNegative()) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE,
                    "price must not be negative, but was {}", price);
        }
        ServiceItem service = new ServiceItem();
        service.id = Ulid.nextId();
        service.companyId = companyId;
        service.specialistId = specialistId;
        service.name = name;
        service.durationMinutes = durationMinutes;
        service.priceMinor = price.minorUnits();
        service.currency = price.currency();
        service.createdAt = now;
        service.updatedAt = now;
        return service;
    }

    // ------------------------------------------------------------------ behaviour

    /** Re-prices an offer. Bookings already taken keep the price they were quoted. */
    public void reprice(Money price, Instant now) {
        if (price == null || price.isNegative()) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE,
                    "price must not be negative, but was {}", price);
        }
        this.priceMinor = price.minorUnits();
        this.currency = price.currency();
        this.updatedAt = now;
    }

    /** Changes how long the service takes; existing bookings keep their own duration. */
    public void retime(int durationMinutes, Instant now) {
        if (durationMinutes < MIN_DURATION_MINUTES || durationMinutes > MAX_DURATION_MINUTES) {
            throw DomainException.of(QtimeErrorCode.INVALID_SERVICE,
                    "duration {} is outside {}..{} minutes",
                    durationMinutes, MIN_DURATION_MINUTES, MAX_DURATION_MINUTES);
        }
        this.durationMinutes = durationMinutes;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ queries

    public Money price() {
        return Money.ofMinor(priceMinor, currency);
    }

    /** True when this specialist may be booked for this offer. */
    public boolean offeredBy(String candidateSpecialistId) {
        return this.specialistId == null || this.specialistId.equals(candidateSpecialistId);
    }

    public boolean belongsToCompany(String candidateCompanyId) {
        return companyId.equals(candidateCompanyId);
    }
}
