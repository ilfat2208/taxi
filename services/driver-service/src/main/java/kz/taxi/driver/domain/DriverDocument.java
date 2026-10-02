package kz.taxi.driver.domain;

import kz.taxi.common.core.id.Ulid;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * A paper the driver holds: licence, technical inspection, medical check.
 *
 * <p>Only the <em>current</em> document of each kind is kept, and the pair
 * {@code (driver_id, kind)} is unique in the database. Renewing a document
 * therefore replaces the expiry date on the existing row instead of piling up
 * rows where "the latest one wins" has to be guessed by every reader.
 *
 * <p>The history of what was on file on a given date belongs to the audit trail,
 * not to this table: a regulator asking "was his medical check valid when the
 * accident happened" must be answered from an append-only log, and mixing the two
 * concerns is how such questions become unanswerable.
 */
@Entity
@Table(name = "driver_document")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class DriverDocument {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "driver_id", length = 26, nullable = false, updatable = false)
    private String driverId;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", length = 32, nullable = false, updatable = false)
    private DocumentKind kind;

    /** Non-null by contract: a document without an expiry date cannot be monitored. */
    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public static DriverDocument issue(String driverId, DocumentKind kind, Instant expiresAt, Instant now) {
        if (expiresAt == null) {
            throw new IllegalArgumentException("a document must have an expiry date");
        }
        DriverDocument document = new DriverDocument();
        document.id = Ulid.nextId();
        document.driverId = driverId;
        document.kind = kind;
        document.expiresAt = expiresAt;
        document.createdAt = now;
        document.updatedAt = now;
        return document;
    }

    /** Extends or replaces the validity of the same kind of document. */
    public void renew(Instant newExpiresAt, Instant now) {
        if (newExpiresAt == null) {
            throw new IllegalArgumentException("a document must have an expiry date");
        }
        this.expiresAt = newExpiresAt;
        this.updatedAt = now;
    }

    /** Valid strictly after {@code now}: the day a document expires it is already useless. */
    public boolean isValidAt(Instant now) {
        return expiresAt.isAfter(now);
    }
}
