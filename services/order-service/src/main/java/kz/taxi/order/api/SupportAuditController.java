package kz.taxi.order.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.order.api.dto.SupportAuditRecordResponse;
import kz.taxi.order.application.SupportAuditService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
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
@RequestMapping("/api/v1/support/audit/orders")
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "Support audit", description = "Read-only view of who read whose orders")
public class SupportAuditController {

    private final SupportAuditService audit;

    public SupportAuditController(SupportAuditService audit) {
        this.audit = audit;
    }

    @GetMapping
    @Operation(summary = "Page the support audit trail, newest first",
            description = "Both filters are optional and match exactly; resourceType is case-insensitive "
                    + "(ORDER, ORDER_HISTORY).")
    public PageResponse<SupportAuditRecordResponse> find(
            @Parameter(description = "ORDER | ORDER_HISTORY")
            @RequestParam(required = false) String resourceType,
            @Parameter(description = "Id of the resource, a collection key, or 'ALL'")
            @RequestParam(required = false) String resourceId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return audit.findAudit(resourceType, resourceId, page, size);
    }
}
