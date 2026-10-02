package kz.taxi.catalog.infrastructure;

import jakarta.persistence.criteria.Predicate;
import kz.taxi.catalog.domain.SupportAuditRecord;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The support audit trail, read and appended.
 *
 * <p>Append-only in practice: the service only ever calls {@code save} (one row per
 * support read) and the audit endpoint's {@code findAll}. There is deliberately no
 * update or delete path anywhere in the code.
 */
public interface SupportAuditRepository extends JpaRepository<SupportAuditRecord, String>,
        JpaSpecificationExecutor<SupportAuditRecord> {

    /**
     * Optional filters of the audit endpoint.
     *
     * <p>Built as a {@link Specification} rather than a JPQL query with
     * {@code (:param is null or ...)} clauses: a null bound parameter in a
     * comparison makes Postgres guess its type, and a support tool must not fail
     * because an operator left a filter empty. Here absent filters simply do not
     * contribute a predicate.
     *
     * @param resourceType  exact match, case-insensitive; blank means "any type"
     * @param resourceId    exact match; blank means "any resource"
     * @param actorUserId   exact match; blank means "any agent". This is the filter the
     *                      compliance question actually needs — "what did agent X read
     *                      this week" — and without it the trail is a write-only table
     * @param from          inclusive lower bound on {@code createdAt}; null means "since ever"
     * @param to            exclusive upper bound on {@code createdAt}; null means "until now"
     */
    static Specification<SupportAuditRecord> filters(String resourceType,
                                                     String resourceId,
                                                     String actorUserId,
                                                     Instant from,
                                                     Instant to) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>(5);
            if (resourceType != null && !resourceType.isBlank()) {
                predicates.add(builder.equal(root.get("resourceType"),
                        resourceType.trim().toUpperCase(Locale.ROOT)));
            }
            if (resourceId != null && !resourceId.isBlank()) {
                predicates.add(builder.equal(root.get("resourceId"), resourceId.trim()));
            }
            if (actorUserId != null && !actorUserId.isBlank()) {
                predicates.add(builder.equal(root.get("actorUserId"), actorUserId.trim()));
            }
            if (from != null) {
                predicates.add(builder.greaterThanOrEqualTo(root.get("createdAt"), from));
            }
            if (to != null) {
                // Exclusive by design: "1 to 2 September" must not double-count the
                // boundary instant when an operator pages through two reports.
                predicates.add(builder.lessThan(root.get("createdAt"), to));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    /** Kept for callers that only filter by resource. */
    static Specification<SupportAuditRecord> filters(String resourceType, String resourceId) {
        return filters(resourceType, resourceId, null, null, null);
    }
}
