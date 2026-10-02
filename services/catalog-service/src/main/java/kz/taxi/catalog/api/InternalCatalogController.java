package kz.taxi.catalog.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.catalog.api.dto.InternalMerchantResponse;
import kz.taxi.catalog.api.dto.InternalProductResponse;
import kz.taxi.catalog.api.dto.ReleaseReservationRequest;
import kz.taxi.catalog.api.dto.ReservationResponse;
import kz.taxi.catalog.api.dto.ReserveStockRequest;
import kz.taxi.catalog.application.CatalogQueryService;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.application.MerchantService;
import kz.taxi.catalog.application.StockReservationService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service stock API, driven by the order service.
 *
 * <p>Everything under {@code /api/v1/catalog/internal/} is protected by the
 * platform's {@code InternalApiTokenFilter} on the {@code X-Internal-Token} header:
 * no user JWT is involved, because the caller acts as a workload (it must be able to
 * reserve stock for an order it does not own), and the public gateway never routes
 * {@code /internal/} paths.
 *
 * <p>Every mutating endpoint is idempotent by {@code orderId}, so a retried saga
 * step can never hold or move the same goods twice. That is why the commit and
 * release calls carry no body beyond the reason.
 */
@RestController
@RequestMapping("/api/v1/catalog/internal")
@Tag(name = "Catalog internal", description = "Service-to-service stock API (X-Internal-Token)")
public class InternalCatalogController {

    private final StockReservationService reservations;
    private final CatalogQueryService catalog;
    private final MerchantService merchants;

    public InternalCatalogController(StockReservationService reservations,
                                     CatalogQueryService catalog,
                                     MerchantService merchants) {
        this.reservations = reservations;
        this.catalog = catalog;
        this.merchants = merchants;
    }

    @PostMapping("/stock/reservations")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Reserve stock for Checkout",
            description = "Idempotent by orderId: a repeat returns the stored reservation unchanged. "
                    + "409 INSUFFICIENT_STOCK when available (on hand - reserved) is short, "
                    + "409 PRODUCT_NOT_AVAILABLE for a draft/archived offer, 400 MIXED_CURRENCIES "
                    + "when the lines do not share one currency, 400 INVALID_QUANTITY outside 1..99.")
    public ReservationResponse reserve(@Valid @RequestBody ReserveStockRequest request) {
        return reservations.reserve(request);
    }

    @PostMapping("/stock/reservations/{orderId}/commit")
    @Operation(summary = "Commit a reservation (payment settled)",
            description = "on_hand -= quantity and reserved -= quantity per line; status becomes COMMITTED. "
                    + "A second call returns the stored state with 200.")
    public ReservationResponse commit(
            @Parameter(description = "Order id used when the stock was reserved") @PathVariable String orderId) {
        return reservations.commit(orderId);
    }

    @PostMapping("/stock/reservations/{orderId}/release")
    @Operation(summary = "Release a reservation (abandoned or failed)",
            description = "Only reserved -= quantity: the goods go back on sale, on_hand is untouched. "
                    + "A second call returns the stored state with 200.")
    public ReservationResponse release(@PathVariable String orderId,
                                       @Valid @RequestBody(required = false) ReleaseReservationRequest request) {
        return reservations.release(orderId, request == null ? null : request.reason());
    }

    @GetMapping("/stock/reservations/{orderId}")
    @Operation(summary = "Stored reservation state", description = "404 RESERVATION_NOT_FOUND when the order never reserved.")
    public ReservationResponse getReservation(@PathVariable String orderId) {
        return reservations.get(orderId);
    }

    @GetMapping("/products/{id}")
    @Operation(summary = "Product for pricing a checkout line",
            description = "Price, currency, status and available quantity. 404 PRODUCT_NOT_FOUND for an unknown id.")
    public InternalProductResponse getProduct(@PathVariable String id) {
        return catalog.getInternalProduct(id);
    }

    @GetMapping("/merchants/{merchantId}")
    @Operation(summary = "Merchant for settling a payout",
            description = "Owner, display name, status and the payout account. `payoutAccountId` is null "
                    + "until the merchant chooses one, and settlement keeps the debt PENDING in that case.")
    public InternalMerchantResponse getMerchant(@PathVariable String merchantId) {
        Merchant merchant = merchants.requireMerchant(merchantId);
        return new InternalMerchantResponse(
                merchant.getId(),
                merchant.getOwnerUserId(),
                merchant.publicName(),
                merchant.getStatus().name(),
                merchant.payoutAccountId());
    }
}