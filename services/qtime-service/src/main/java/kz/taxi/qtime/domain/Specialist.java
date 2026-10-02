package kz.taxi.qtime.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * The person who actually does the work.
 *
 * <p>Every window belongs to a specialist, never to a company: "в салоне свободно
 * в 15:30" is not a promise anybody can keep — "у Айгуль свободно в 15:30" is. That
 * is why the schedule tables hang off this entity and not off {@link Company}.
 *
 * <p>There is deliberately no "is this specialist currently employed" flag: a
 * master who left is removed from the working week (no {@link WorkingHours} rows,
 * no free slots), and their past bookings keep pointing at them — the history of
 * who did what must survive the staffing change.
 */
@Entity
@Table(name = "specialist")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Specialist {

    public static final int MAX_RATING_BP = 50_000;
    public static final int MAX_EXPERIENCE_YEARS = 80;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "company_id", length = 26, nullable = false, updatable = false)
    private String companyId;

    @Column(name = "full_name", length = 128, nullable = false)
    private String fullName;

    /** Должность или специализация: "мастер маникюра", "мастер-приёмщик", "врач-стоматолог". */
    @Column(name = "specialization", length = 128, nullable = false)
    private String specialization;

    @Column(name = "rating_bp", nullable = false)
    private int ratingBp;

    @Column(name = "experience_years", nullable = false)
    private int experienceYears;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    public static Specialist register(String companyId, String fullName, String specialization,
                                      int ratingBp, int experienceYears, Instant now) {
        if (companyId == null || companyId.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_SPECIALIST, "companyId is required");
        }
        if (fullName == null || fullName.isBlank()) {
            throw DomainException.of(QtimeErrorCode.INVALID_SPECIALIST, "fullName is required");
        }
        if (ratingBp < 0 || ratingBp > MAX_RATING_BP) {
            throw DomainException.of(QtimeErrorCode.INVALID_SPECIALIST,
                    "rating {} is outside 0..{} basis points", ratingBp, MAX_RATING_BP);
        }
        if (experienceYears < 0 || experienceYears > MAX_EXPERIENCE_YEARS) {
            throw DomainException.of(QtimeErrorCode.INVALID_SPECIALIST,
                    "experienceYears {} is outside 0..{}", experienceYears, MAX_EXPERIENCE_YEARS);
        }
        Specialist specialist = new Specialist();
        specialist.id = Ulid.nextId();
        specialist.companyId = companyId;
        specialist.fullName = fullName;
        specialist.specialization = specialization == null || specialization.isBlank()
                ? "специалист"
                : specialization;
        specialist.ratingBp = ratingBp;
        specialist.experienceYears = experienceYears;
        specialist.createdAt = now;
        specialist.updatedAt = now;
        return specialist;
    }

    // ------------------------------------------------------------------ behaviour

    public void updateRating(int ratingBp, Instant now) {
        if (ratingBp < 0 || ratingBp > MAX_RATING_BP) {
            throw DomainException.of(QtimeErrorCode.INVALID_SPECIALIST,
                    "rating {} is outside 0..{} basis points", ratingBp, MAX_RATING_BP);
        }
        this.ratingBp = ratingBp;
        this.updatedAt = now;
    }

    // ------------------------------------------------------------------ queries

    public boolean worksFor(String candidateCompanyId) {
        return companyId.equals(candidateCompanyId);
    }
}
