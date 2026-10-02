package kz.taxi.order.infrastructure;

import jakarta.persistence.criteria.Predicate;
import kz.taxi.order.domain.SupportAuditRecord;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

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
     */
    static Specification<SupportAuditRecord> filters(String resourceType, String resourceId) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>(2);
            if (resourceType != null && !resourceType.isBlank()) {
                predicates.add(builder.equal(root.get("resourceType"),
                        resourceType.trim().toUpperCase(Locale.ROOT)));
            }
            if (resourceId != null && !resourceId.isBlank()) {
                predicates.add(builder.equal(root.get("resourceId"), resourceId.trim()));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }
}
