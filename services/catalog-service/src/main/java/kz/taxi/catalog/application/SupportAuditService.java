package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.SupportAuditRecordResponse;
import kz.taxi.catalog.api.mapper.SupportMapper;
import kz.taxi.catalog.domain.SupportAction;
import kz.taxi.catalog.domain.SupportAuditRecord;
import kz.taxi.catalog.infrastructure.SupportAuditRepository;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.web.PageResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

/**
 * The support audit trail: write one row per support read, and read the trail back.
 *
 * <p><strong>Write.</strong> {@link #append} joins the caller's transaction and
 * refuses to run without one ({@link Propagation#MANDATORY}). That is the whole
 * point of the class: a read and its audit row commit together, so
 * "the data was returned" and "the row exists" can never disagree. Two consequences
 * fall out of it, both intended:
 *
 * <ul>
 *   <li>a lookup that found nothing throws before {@code append} is reached, and the
 *       rolled-back transaction leaves no row — the trail records data that was
 *       actually handed out, not guesses at ids that do not exist;</li>
 *   <li>a database failure while appending fails the read as well. An untraceable
 *       support read is worse than a refused one.</li>
 * </ul>
 *
 * <p><strong>Read.</strong> {@link #findAudit} serves the ADMIN-only endpoint, so the
 * log is not write-only. Reading it is deliberately not recorded in the table it
 * reads: that endpoint pages through the trail, and a page scan that appends to the
 * table it is scanning shifts every following page — the trail would be describing
 * itself instead of the data access it exists for.
 */
@Service
@Slf4j
public class SupportAuditService {

    private static final int DEFAULT_PAGE_SIZE = 50;
    private static final int MAX_PAGE_SIZE = 200;

    private final SupportAuditRepository repository;

    public SupportAuditService(SupportAuditRepository repository) {
        this.repository = repository;
    }

    /**
     * Appends the audit row of one support read, inside the caller's transaction.
     *
     * <p>Must be called <em>after</em> the resource has been loaded and mapped: the
     * record means "this actor was served this resource", so it is written last and
     * only on the success path.
     *
     * @param action      which support read happened (its code, endpoint and resource
     *                    type are all taken from the enum, so a new endpoint cannot
     *                    forget part of the row)
     * @param resourceId  key of what was returned: the resource id, the collection
     *                    key, or {@link SupportAuditRecord#RESOURCE_ALL}
     * @param actorUserId the support agent or admin from the JWT subject
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void append(SupportAction action, String resourceId, String actorUserId) {
        String correlationId = CorrelationContext.getOrCreate();
        SupportAuditRecord record = SupportAuditRecord.of(actorUserId, action.code(), action.endpoint(),
                action.resourceType().name(), resourceId, correlationId);
        repository.save(record);
        log.debug("support read audited: actor={} action={} resource={}/{} correlation={}",
                actorUserId, action.code(), action.resourceType(), resourceId, correlationId);
    }

    /**
     * Pages the trail, newest first.
     *
     * <p>Page and size are clamped here: {@code size=100000} from a browser would
     * otherwise turn the audit log into the slowest query in the service.
     */
    @Transactional(readOnly = true)
    public PageResponse<SupportAuditRecordResponse> findAudit(String resourceType,
                                                              String resourceId,
                                                              String actorUserId,
                                                              Instant from,
                                                              Instant to,
                                                              int page,
                                                              int size) {
        int safePage = Math.max(page, 0);
        int safeSize = size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        Page<SupportAuditRecord> found = repository.findAll(
                SupportAuditRepository.filters(resourceType, resourceId, actorUserId, from, to),
                PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "createdAt")));
        return PageResponse.of(found.getContent(), found.getNumber(), found.getSize(),
                found.getTotalElements(), SupportMapper::toAuditRecord);
    }

    /** Overload kept for callers that filter only by resource. */
    @Transactional(readOnly = true)
    public PageResponse<SupportAuditRecordResponse> findAudit(String resourceType,
                                                              String resourceId,
                                                              int page,
                                                              int size) {
        return findAudit(resourceType, resourceId, null, null, null, page, size);
    }
}
