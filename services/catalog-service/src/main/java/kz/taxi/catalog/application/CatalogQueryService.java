package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.InternalProductResponse;
import kz.taxi.catalog.api.dto.MerchantSummaryResponse;
import kz.taxi.catalog.api.dto.ProductDetailResponse;
import kz.taxi.catalog.api.dto.ProductSummaryResponse;
import kz.taxi.catalog.api.mapper.CatalogMapper;
import kz.taxi.catalog.domain.Availability;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductSort;
import kz.taxi.catalog.domain.ProductStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.ProductSearchCriteria;
import kz.taxi.catalog.infrastructure.ProductSearchDao;
import kz.taxi.catalog.infrastructure.ProductSearchPage;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Reads of the public catalog and of the internal product endpoint.
 *
 * <p>Every method is {@code readOnly}: this service never mutates state, which
 * keeps write locking and read paths from sharing a class (and lets the driver run
 * these queries in a read-only transaction).
 */
@Service
public class CatalogQueryService {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final ProductSearchDao searchDao;
    private final ProductRepository products;
    private final MerchantRepository merchants;
    private final StockRepository stocks;

    public CatalogQueryService(ProductSearchDao searchDao,
                               ProductRepository products,
                               MerchantRepository merchants,
                               StockRepository stocks) {
        this.searchDao = searchDao;
        this.products = products;
        this.merchants = merchants;
        this.stocks = stocks;
    }

    /**
     * Searches the catalog.
     *
     * <p>Page and size are clamped here rather than trusted: {@code size=100000}
     * from a client would otherwise turn one request into a full table scan and a
     * multi-megabyte response.
     */
    @Transactional(readOnly = true)
    public PageResponse<ProductSummaryResponse> searchProducts(ProductSearchCriteria criteria,
                                                              ProductSort sort,
                                                              int page,
                                                              int size) {
        int safePage = Math.max(page, 0);
        int safeSize = size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
        ProductSearchPage result = searchDao.search(criteria, sort, safePage, safeSize);
        return PageResponse.of(result.rows(), safePage, safeSize, result.totalElements(),
                CatalogMapper::toSummary);
    }

    @Transactional(readOnly = true)
    public ProductDetailResponse getProduct(String productId) {
        Product product = products.findById(productId)
                .filter(candidate -> !candidate.isArchived())
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                        "product {} not found", productId));
        Merchant merchant = requireMerchant(product.getMerchantId());
        return CatalogMapper.toDetail(product, merchant, availabilityOf(productId));
    }

    /** Categories a shopper can browse: only those with at least one offer on sale. */
    @Transactional(readOnly = true)
    public List<String> listCategories() {
        return products.findCategoriesByStatus(ProductStatus.ACTIVE);
    }

    @Transactional(readOnly = true)
    public MerchantSummaryResponse getPublicMerchant(String merchantId) {
        return CatalogMapper.toMerchantSummary(requireMerchant(merchantId));
    }

    /**
     * The order service's view of a product.
     *
     * <p>Archived products are still returned (with their status) because checkout
     * needs to distinguish "this id never existed" (404) from "this offer was
     * withdrawn" (a sellability decision it makes on {@code status}).
     */
    @Transactional(readOnly = true)
    public InternalProductResponse getInternalProduct(String productId) {
        Product product = products.findById(productId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                        "product {} not found", productId));
        return CatalogMapper.toInternalProduct(product, availabilityOf(productId));
    }

    private Merchant requireMerchant(String merchantId) {
        return merchants.findById(merchantId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "merchant {} not found", merchantId));
    }

    /** A product always has a stock row; the fallback keeps a hand-fixed database readable. */
    private Availability availabilityOf(String productId) {
        return stocks.findById(productId).map(Stock::availability).orElseGet(Availability::empty);
    }
}
