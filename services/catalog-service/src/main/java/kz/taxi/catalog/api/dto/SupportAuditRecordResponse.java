package kz.taxi.catalog.api.dto;

import java.time.Instant;

/**
 * One row of the support audit trail, as the ADMIN-only endpoint returns it.
 *
 * <p>The endpoint exists so the log is not write-only: an audit table nobody can
 * read proves nothing to the merchant who asks "who looked at my data?".
 */
public record SupportAuditRecordResponse(
        String id,
        String actorUserId,
        String action,
        String endpoint,
        String resourceType,
        String resourceId,
        String correlationId,
        Instant createdAt
) {
}
