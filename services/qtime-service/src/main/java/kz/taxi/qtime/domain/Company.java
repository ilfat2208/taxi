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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.ZoneId;

/**
 * A company that owns a schedule: a salon, a СТО, a clinic, a barbershop.
 *
 * <p>The load-bearing field is not the name but {@link #timeZone}: "09:00" is a
 * local promise, and the platform stores every instant in UTC. A company that
 * cannot say which zone its own opening hours are in cannot publish a free window
 * that means anything — so the zone is required, not defaulted at read time.
 *
 * <p>{@link #SUSPENDED} is a booking brake rather than a delete: history stays,
 * and so do the appointments people already made.
 */
@Entity
@Table(name = "company")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Company {

    /** Ratings are basis points: 50_000 is 5.00. Never a double. */
    public static final int MAX_RATING_BP = 50_000;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "name", length = 160, nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "category", length = 24, nullable = false)
    private CompanyCategory category;

    @Column(name = "city", length = 64, nullable = false)
    private String city;

    @Column(name = "address", length = 255, nullable = false)
    private String address;

    @Column(name = "lat", nullable = false)
    private double lat;

    @Column(name = "lon", nullable = false)
    private double lon;

    /** Rating in basis points, averaged over reviews by the reviews subsystem (Ф2). */
    @Column(name = "rating_bp", nullable = false)
    private int ratingBp;

    @Column(name = "reviews_count", nullable = false)
    private int reviewsCount;

    /** IANA zone id, e.g. {@code Asia/Almaty}: the zone the opening hours are written in. */
    @Column(name = "time_zone", length = 64, nullable = false)
    private String timeZone;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private CompanyStatus status;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Registers a company. It starts with no rating: reviews arrive on their own schedule. */
    public static Company register(String name, CompanyCategory category, String city, String address,
                                   double lat, double lon, String timeZone, Instant now) {
        requireText(name, "name");
        requireText(city, "city");
        requireText(address, "address");
        if (category == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY, "category is required");
        }
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY,
                    "coordinates {},{} are outside the globe", lat, lon);
        }
        Company company = new Company();
        company.id = Ulid.nextId();
        company.name = name;
        company.category = category;
        company.city = city;
        company.address = address;
        company.lat = lat;
        company.lon = lon;
        company.ratingBp = 0;
        company.reviewsCount = 0;
        // Fails loudly on a typo like "Asia/Almatyy" instead of silently shifting
        // every published window by an hour or two.
        company.timeZone = requireZone(timeZone).getId();
        company.status = CompanyStatus.ACTIVE;
        company.createdAt = now;
        company.updatedAt = now;
        return company;
    }

    // ------------------------------------------------------------------ behaviour

    /** Applies a rating recomputed from reviews (or seeded for a demo company). */
    public void updateRating(int ratingBp, int reviewsCount, Instant now) {
        if (ratingBp < 0 || ratingBp > MAX_RATING_BP) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY,
                    "rating {} is outside 0..{} basis points", ratingBp, MAX_RATING_BP);
        }
        if (reviewsCount < 0) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY,
                    "reviewsCount must not be negative but was {}", reviewsCount);
        }
        this.ratingBp = ratingBp;
        this.reviewsCount = reviewsCount;
        this.updatedAt = now;
    }

    /** Takes the company off the marketplace: history stays, new bookings do not. */
    public void suspend(Instant now) {
        this.status = CompanyStatus.SUSPENDED;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ queries

    /** The zone the company's opening hours are written in. */
    public ZoneId zone() {
        return ZoneId.of(timeZone);
    }

    public boolean acceptsBookings() {
        return status == CompanyStatus.ACTIVE;
    }

    // ------------------------------------------------------------------ validation

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY, "{} is required", field);
        }
    }

    private static ZoneId requireZone(String timeZone) {
        if (timeZone == null || timeZone.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY, "timeZone is required");
        }
        try {
            return ZoneId.of(timeZone.trim());
        } catch (RuntimeException unknownZone) {
            throw DomainException.of(QtimeErrorCode.INVALID_COMPANY,
                            "unknown time zone '{}'", timeZone)
                    .withDetail("timeZone", timeZone);
        }
    }
}
