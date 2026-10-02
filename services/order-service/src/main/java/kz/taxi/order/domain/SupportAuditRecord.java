package kz.taxi.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.error.Preconditions;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Append-only audit row of one support read.
 *
 * <p>Support access is the one kind of access that must leave a trace: a support
 * agent reading somebody else's orders is legitimate, but the customer is entitled
 * to know it happened and an auditor is entitled to see who did it. The row records
 * who ({@code actorUserId}), what ({@code action} + {@code endpoint}), which resource
 * ({@code resourceType} + {@code resourceId}), when ({@code createdAt}) and the
 * request's correlation id.
 *
 * <p>Two rules make the trail trustworthy, and both are enforced by the caller
 * rather than by this entity:
 * <ul>
 *   <li>the row is written <strong>in the same transaction</strong> as the read it
 *       describes (see {@code SupportAuditService.append}), so a read that returned
 *       data always has its row and a rolled-back read has none;</li>
 *   <li>a lookup that found nothing writes <strong>nothing</strong>: the table
 *       records data that was actually handed out, not probes for ids that do not
 *       exist, which would let an enumeration attempt fill the table with garbage.</li>
 * </ul>
 *
 * <p>Note that this is not the same trail as {@link OrderStatusHistory}: that one
 * describes what happened <em>to</em> an order, this one describes who
 * <em>looked at</em> it. Keeping them apart is what makes "who read my order?"
 * answerable at all.
 */
@Entity
@Table(name = "support_audit_record")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SupportAuditRecord {

    /**
     * Resource id stored when a read returned a whole collection instead of one row
     * (an unfiltered scan). A literal keeps {@code resource_id} NOT NULL, so no
     * query on it ever has to special-case a missing value.
     */
    public static final String RESOURCE_ALL = "ALL";

    /**
     * Column widths are part of the schema; the correlation id in particular arrives
     * from a client header, which the filter accepts up to 128 characters long.
     */
    private static final int ACTOR_LENGTH = 64;
    private static final int ACTION_LENGTH = 64;
    private static final int ENDPOINT_LENGTH = 160;
    private static final int RESOURCE_TYPE_LENGTH = 32;
    private static final int RESOURCE_ID_LENGTH = 64;
    private static final int CORRELATION_LENGTH = 64;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "actor_user_id", length = ACTOR_LENGTH, nullable = false, updatable = false)
    private String actorUserId;

    @Column(name = "action", length = ACTION_LENGTH, nullable = false, updatable = false)
    private String action;

    @Column(name = "endpoint", length = ENDPOINT_LENGTH, nullable = false, updatable = false)
    private String endpoint;

    @Column(name = "resource_type", length = RESOURCE_TYPE_LENGTH, nullable = false, updatable = false)
    private String resourceType;

    @Column(name = "resource_id", length = RESOURCE_ID_LENGTH, nullable = false, updatable = false)
    private String resourceId;

    @Column(name = "correlation_id", length = CORRELATION_LENGTH, nullable = false, updatable = false)
    private String correlationId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * Records one support read.
     *
     * <p>The correlation id is truncated rather than trusted: an over-long header
     * must never turn an audit insert into a failed read, because that would make
     * the trail an availability risk for the very data it protects.
     */
    public static SupportAuditRecord of(String actorUserId,
                                        String action,
                                        String endpoint,
                                        String resourceType,
                                        String resourceId,
                                        String correlationId) {
        Preconditions.requireText(actorUserId, "actorUserId");
        Preconditions.requireText(action, "action");
        Preconditions.requireText(endpoint, "endpoint");
        Preconditions.requireText(resourceType, "resourceType");
        Preconditions.requireText(resourceId, "resourceId");
        Preconditions.requireText(correlationId, "correlationId");

        SupportAuditRecord record = new SupportAuditRecord();
        record.id = Ulid.nextId();
        record.actorUserId = truncate(actorUserId, ACTOR_LENGTH);
        record.action = truncate(action, ACTION_LENGTH);
        record.endpoint = truncate(endpoint, ENDPOINT_LENGTH);
        record.resourceType = truncate(resourceType, RESOURCE_TYPE_LENGTH);
        record.resourceId = truncate(resourceId, RESOURCE_ID_LENGTH);
        record.correlationId = truncate(correlationId, CORRELATION_LENGTH);
        record.createdAt = Instant.now();
        return record;
    }

    private static String truncate(String value, int max) {
        String trimmed = value.trim();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}
