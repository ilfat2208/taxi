package kz.taxi.catalog.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.catalog.api.dto.SupportMerchantResponse;
import kz.taxi.catalog.api.dto.SupportProductResponse;
import kz.taxi.catalog.api.dto.SupportReservationResponse;
import kz.taxi.catalog.api.dto.SupportStockResponse;
import kz.taxi.catalog.application.SupportCatalogService;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.CurrentUser;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only support access to other people's merchant data.
 *
 * <p>The {@code SUPPORT} role exists in the platform's JWT precisely for this: an
 * agent who must answer "why can this customer not buy?" without being handed admin
 * rights. Every endpoint here is a GET — support never changes a thing, and no
 * cancel, publish or stock adjustment is reachable from this class.
 *
 * <p>The role check is on the class because all of these paths share one rule, and
 * every one of them is audited in the use case behind it
 * ({@code SupportCatalogService}): who read what, and under which correlation id.
 * Reading is not free of consequence here, which is the point.
 */
@RestController
@RequestMapping("/api/v1/support")
@PreAuthorize("hasAnyRole('SUPPORT','ADMIN')")
@Tag(name = "Support", description = "Read-only operator access to merchant data; every call is audited")
public class SupportCatalogController {

    private final SupportCatalogService support;
    private final CurrentUser currentUser;

    public SupportCatalogController(SupportCatalogService support, CurrentUser currentUser) {
        this.support = support;
        this.currentUser = currentUser;
    }

    @GetMapping("/merchants/{merchantId}")
    @Operation(summary = "A merchant profile by id",
            description = "The full profile, contacts, payout account and product count included — more than the "
                    + "public summary, which is why this read is audited.")
    public SupportMerchantResponse merchantById(@PathVariable String merchantId) {
        return support.merchantById(merchantId, currentUser.requireUserId());
    }

    @GetMapping("/merchants/by-owner/{ownerUserId}")
    @Operation(summary = "A merchant profile by its owner user id",
            description = "A support conversation starts from a person: this turns the caller's user id into the "
                    + "shop id every other endpoint is keyed by.")
    public SupportMerchantResponse merchantByOwner(@PathVariable String ownerUserId) {
        return support.merchantByOwnerUserId(ownerUserId, currentUser.requireUserId());
    }

    @GetMapping("/merchants/{merchantId}/products")
    @Operation(summary = "A merchant's catalog, drafts included",
            description = "Drafts are always returned — an offer the shopper cannot see is the most common answer "
                    + "to \"why can't this customer buy it?\". Archived offers are included only on request.")
    public PageResponse<SupportProductResponse> products(
            @PathVariable String merchantId,
            @Parameter(description = "Also return offers the merchant withdrew")
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return support.productsOfMerchant(merchantId, includeArchived, page, size, currentUser.requireUserId());
    }

    @GetMapping("/products/{productId}")
    @Operation(summary = "One offer with its status and availability",
            description = "Answers the purchase question directly: `buyable` is false when the status cannot be "
                    + "sold (DRAFT/ARCHIVED) or when nothing is available, and `unavailableReason` names which.")
    public SupportProductResponse product(@PathVariable String productId) {
        return support.product(productId, currentUser.requireUserId());
    }

    @GetMapping("/products/{productId}/stock")
    @Operation(summary = "The stock of one offer and the holds behind it",
            description = "The counters plus the most recent reservations, so \"nothing available\" can be "
                    + "explained by the checkouts that are holding the units.")
    public SupportStockResponse stock(@PathVariable String productId) {
        return support.stock(productId, currentUser.requireUserId());
    }

    @GetMapping("/reservations/{orderId}")
    @Operation(summary = "Every stock hold of one checkout",
            description = "404 RESERVATION_NOT_FOUND when this service has never reserved stock for that order.")
    public List<SupportReservationResponse> reservations(@PathVariable String orderId) {
        return support.reservationsOfOrder(orderId, currentUser.requireUserId());
    }
}
