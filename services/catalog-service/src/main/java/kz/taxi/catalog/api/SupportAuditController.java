package kz.taxi.catalog.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.catalog.api.dto.SupportAuditRecordResponse;
import kz.taxi.catalog.application.SupportAuditService;
import kz.taxi.common.core.web.PageResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import java.time.Instant;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The support audit trail, readable.
 *
 * <p>An audit log nobody can read proves nothing, so this is the read side of the
 * trail the support endpoints write. {@code ADMIN} only, and read-only by
 * construction: there is no POST, no PATCH and no DELETE on it — the table behind it
 * is append-only.
 *
 * <p>Reading the trail is intentionally not recorded in the trail itself: this
 * endpoint pages through those very rows, and appending a row per page would make
 * the log describe itself while shifting the pages underneath the reader.
 */
@RestController
@RequestMapping("/api/v1/support/audit/catalog")
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "Support audit", description = "Read-only view of who read which merchant data")
public class SupportAuditController {

    private final SupportAuditService audit;

    public SupportAuditController(SupportAuditService audit) {
        this.audit = audit;
    }

    @GetMapping
    @Operation(summary = "Page the support audit trail, newest first",
            description = "Both filters are optional and match exactly; resourceType is case-insensitive "
                    + "(MERCHANT, PRODUCT, STOCK, RESERVATION).")
    public PageResponse<SupportAuditRecordResponse> find(
            @Parameter(description = "MERCHANT | PRODUCT | STOCK | RESERVATION")
            @RequestParam(required = false) String resourceType,
            @Parameter(description = "Id of the resource, or 'ALL' for collection reads")
            @RequestParam(required = false) String resourceId,
            @RequestParam(required = false) String actorUserId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return audit.findAudit(resourceType, resourceId, actorUserId, from, to, page, size);
    }
}
