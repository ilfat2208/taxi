package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.InternalProductResponse;
import kz.taxi.catalog.api.dto.MerchantSummaryResponse;
import kz.taxi.catalog.api.dto.ProductDetailResponse;
import kz.taxi.catalog.api.dto.ProductSummaryResponse;
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
import kz.taxi.catalog.infrastructure.ProductSearchRow;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.web.PageResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The read side: paging hygiene, what is hidden from shoppers, and mapper wiring. */
class CatalogQueryServiceTest {

    private static final String PRODUCT_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1T";
    private static final String MERCHANT_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1V";

    private ProductSearchDao searchDao;
    private ProductRepository products;
    private MerchantRepository merchants;
    private StockRepository stocks;
    private CatalogQueryService service;

    @BeforeEach
    void setUp() {
        searchDao = mock(ProductSearchDao.class);
        products = mock(ProductRepository.class);
        merchants = mock(MerchantRepository.class);
        stocks = mock(StockRepository.class);
        service = new CatalogQueryService(searchDao, products, merchants, stocks);
    }

    @Test
    void searchMapsRowsIntoAPageOfSummaries() {
        ProductSearchRow row = new ProductSearchRow(PRODUCT_ID, MERCHANT_ID, "TechnoMart Store",
                "Смартфон", "описание", "Электроника", "Samsung", 189_990_00L, "KZT",
                "https://img.example/a.jpg", ProductStatus.ACTIVE.name(), 7);
        when(searchDao.search(any(), eq(ProductSort.PRICE_ASC), eq(2), eq(10)))
                .thenReturn(new ProductSearchPage(List.of(row), 42L));

        PageResponse<ProductSummaryResponse> page = service.searchProducts(
                ProductSearchCriteria.of("смартфон", null, null, null, null), ProductSort.PRICE_ASC, 2, 10);

        assertThat(page.page()).isEqualTo(2);
        assertThat(page.size()).isEqualTo(10);
        assertThat(page.totalElements()).isEqualTo(42L);
        assertThat(page.totalPages()).isEqualTo(5);
        assertThat(page.hasNext()).isTrue();
        assertThat(page.items()).singleElement().satisfies(summary -> {
            assertThat(summary.id()).isEqualTo(PRODUCT_ID);
            assertThat(summary.merchantName()).isEqualTo("TechnoMart Store");
            assertThat(summary.priceMinor()).isEqualTo(189_990_00L);
            assertThat(summary.status()).isEqualTo(ProductStatus.ACTIVE);
            assertThat(summary.availableQuantity()).isEqualTo(7);
        });
    }

    @Test
    void anOversizedPageIsClampedAndANegativePageIsTreatedAsTheFirst() {
        when(searchDao.search(any(), any(), eq(0), eq(100)))
                .thenReturn(new ProductSearchPage(List.of(), 0L));

        PageResponse<ProductSummaryResponse> page = service.searchProducts(
                ProductSearchCriteria.of(null, null, null, null, null), ProductSort.NEWEST, -3, 5_000);

        assertThat(page.page()).isZero();
        assertThat(page.size()).isEqualTo(100);
        assertThat(page.items()).isEmpty();
        verify(searchDao).search(any(), eq(ProductSort.NEWEST), eq(0), eq(100));
    }

    @Test
    void productCardCarriesTheSellerAndTheWholeStockTriple() {
        Merchant merchant = Merchant.register("user-1", "TechnoMart", "TechnoMart Store",
                "+77000000000", "shop@example.com", "Алматы");
        Product product = Product.publish(merchant.getId(), "TECH-1", "Смартфон", null,
                "Электроника", "Samsung", Currency.KZT, 189_990_00L, null);
        Stock stock = Stock.withOnHand(product.getId(), 5);
        stock.reserve(2);
        when(products.findById(product.getId())).thenReturn(Optional.of(product));
        when(merchants.findById(merchant.getId())).thenReturn(Optional.of(merchant));
        when(stocks.findById(product.getId())).thenReturn(Optional.of(stock));

        ProductDetailResponse detail = service.getProduct(product.getId());

        assertThat(detail.onHand()).isEqualTo(5);
        assertThat(detail.reserved()).isEqualTo(2);
        assertThat(detail.available()).isEqualTo(3);
        assertThat(detail.availableQuantity()).isEqualTo(3);
        assertThat(detail.merchant().displayName()).isEqualTo("TechnoMart Store");
        // The public card must not leak the seller's contact details.
        assertThat(detail.merchant().id()).isEqualTo(merchant.getId());
    }

    @Test
    void anArchivedProductIsNotVisibleInThePublicCatalog() {
        Merchant merchant = Merchant.register("user-1", "TechnoMart", null, null, null, null);
        Product product = Product.publish(merchant.getId(), "TECH-1", "Смартфон", null,
                "Электроника", null, Currency.KZT, 1_000L, null);
        product.changeStatus(ProductStatus.ARCHIVED);
        when(products.findById(product.getId())).thenReturn(Optional.of(product));

        assertThatThrownBy(() -> service.getProduct(product.getId()))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.PRODUCT_NOT_FOUND));
    }

    @Test
    void theInternalViewReportsStatusAndAvailability() {
        Merchant merchant = Merchant.register("user-1", "TechnoMart", null, null, null, null);
        Product product = Product.publish(merchant.getId(), "TECH-1", "Смартфон", null,
                "Электроника", null, Currency.KZT, 1_000L, null);
        when(products.findById(product.getId())).thenReturn(Optional.of(product));
        when(stocks.findById(product.getId())).thenReturn(Optional.of(Stock.withOnHand(product.getId(), 4)));

        InternalProductResponse internal = service.getInternalProduct(product.getId());

        assertThat(internal.priceMinor()).isEqualTo(1_000L);
        assertThat(internal.currency()).isEqualTo("KZT");
        assertThat(internal.status()).isEqualTo(ProductStatus.ACTIVE);
        assertThat(internal.availableQuantity()).isEqualTo(4);
    }

    @Test
    void anUnknownInternalProductIsNotFound() {
        when(products.findById(PRODUCT_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getInternalProduct(PRODUCT_ID))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.PRODUCT_NOT_FOUND));
    }

    @Test
    void categoriesComeFromActiveOffersOnly() {
        when(products.findCategoriesByStatus(ProductStatus.ACTIVE))
                .thenReturn(List.of("Бытовая техника", "Красота", "Продукты", "Электроника"));

        assertThat(service.listCategories()).containsExactly(
                "Бытовая техника", "Красота", "Продукты", "Электроника");
    }

    @Test
    void publicMerchantSummaryHidesContactsAndTheOwner() {
        Merchant merchant = Merchant.register("user-1", "TechnoMart", "TechnoMart Store",
                "+77000000000", "shop@example.com", "Алматы");
        when(merchants.findById(merchant.getId())).thenReturn(Optional.of(merchant));

        MerchantSummaryResponse summary = service.getPublicMerchant(merchant.getId());

        assertThat(summary.name()).isEqualTo("TechnoMart");
        assertThat(summary.displayName()).isEqualTo("TechnoMart Store");
        assertThat(summary.city()).isEqualTo("Алматы");
        assertThat(summary.ratingBasisPoints()).isZero();
    }

    @Test
    void anUnknownMerchantIsNotFound() {
        when(merchants.findById(MERCHANT_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.getPublicMerchant(MERCHANT_ID))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.MERCHANT_NOT_FOUND));
    }

    @Test
    void aProductWithoutAStockRowReadsAsNothingAvailable() {
        Merchant merchant = Merchant.register("user-1", "TechnoMart", null, null, null, null);
        Product product = Product.publish(merchant.getId(), "TECH-1", "Смартфон", null,
                "Электроника", null, Currency.KZT, 1_000L, null);
        when(products.findById(product.getId())).thenReturn(Optional.of(product));
        when(merchants.findById(merchant.getId())).thenReturn(Optional.of(merchant));
        when(stocks.findById(product.getId())).thenReturn(Optional.empty());

        ProductDetailResponse detail = service.getProduct(product.getId());

        assertThat(detail.onHand()).isZero();
        assertThat(detail.available()).isZero();
    }

    @Test
    void searchCriteriaNormalizesBlankFilters() {
        ProductSearchCriteria criteria = ProductSearchCriteria.of("  ", "", "   ", null, null);

        assertThat(criteria.hasQuery()).isFalse();
        assertThat(criteria.hasCategory()).isFalse();
        assertThat(criteria.hasMerchantId()).isFalse();
        assertThat(criteria.query()).isNull();
    }
}
