package kz.taxi.catalog.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.catalog.api.dto.CreateProductRequest;
import kz.taxi.catalog.api.dto.ProductDetailResponse;
import kz.taxi.catalog.api.dto.ProductSummaryResponse;
import kz.taxi.catalog.api.dto.UpdateProductRequest;
import kz.taxi.catalog.application.CatalogQueryService;
import kz.taxi.catalog.application.ProductService;
import kz.taxi.catalog.domain.ProductSort;
import kz.taxi.catalog.infrastructure.ProductSearchCriteria;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The catalog's product endpoints.
 *
 * <p>Reads are public (declared in {@code taxi.security.public-paths}), writes are
 * not: they are gated by {@code @PreAuthorize} plus an ownership check in the use
 * case. The annotation is on the controller because the path pattern that makes the
 * GETs public also covers these paths — the URL cannot express "public to read,
 * merchant-only to write", so the method rule has to.
 */
@RestController
@RequestMapping("/api/v1/catalog/products")
@Tag(name = "Catalog", description = "Marketplace catalog: search, product cards, merchant offers")
public class ProductController {

    private final CatalogQueryService catalog;
    private final ProductService products;
    private final CurrentUser currentUser;

    public ProductController(CatalogQueryService catalog, ProductService products, CurrentUser currentUser) {
        this.catalog = catalog;
        this.products = products;
        this.currentUser = currentUser;
    }

    @GetMapping
    @Operation(summary = "Search the catalog",
            description = "Free-text search runs over the Postgres search_vector column "
                    + "(websearch_to_tsquery, ranked with ts_rank); every other filter is an exact match. "
                    + "Archived offers are never returned.")
    public PageResponse<ProductSummaryResponse> search(
            @Parameter(description = "Free text: words, \"quoted phrases\", OR, -excluded")
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String merchantId,
            @RequestParam(required = false) Long minPriceMinor,
            @RequestParam(required = false) Long maxPriceMinor,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @Parameter(description = "price_asc | price_desc | newest | relevance")
            @RequestParam(defaultValue = "relevance") String sort) {
        return catalog.searchProducts(
                ProductSearchCriteria.of(query, category, merchantId, minPriceMinor, maxPriceMinor),
                ProductSort.parse(sort), page, size);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Product card",
            description = "Adds the seller block and the stock triple (on hand / reserved / available).")
    public ProductDetailResponse getById(@PathVariable String id) {
        return catalog.getProduct(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('MERCHANT')")
    @Operation(summary = "Publish a product",
            description = "Creates the offer together with its stock row. 409 DUPLICATE_SKU when the "
                    + "merchant already sells this SKU.")
    public ProductDetailResponse create(@Valid @RequestBody CreateProductRequest request) {
        return products.createProduct(currentUser.requireUserId(), request);
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('MERCHANT')")
    @Operation(summary = "Update a product",
            description = "Partial update of the owning merchant's offer, including a stock delta. "
                    + "422 STOCK_ADJUSTMENT_INVALID when on hand would fall below reserved.")
    public ProductDetailResponse update(@PathVariable String id,
                                        @Valid @RequestBody UpdateProductRequest request) {
        return products.updateProduct(currentUser.requireUserId(), id, request);
    }
}
