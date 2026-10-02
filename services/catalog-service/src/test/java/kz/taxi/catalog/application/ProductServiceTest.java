package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.CreateProductRequest;
import kz.taxi.catalog.api.dto.ProductDetailResponse;
import kz.taxi.catalog.api.dto.UpdateProductRequest;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.events.ProductPublishedEvent;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Merchant-facing catalog writes: ownership, duplicate SKUs and stock adjustments. */
class ProductServiceTest {

    private static final String OWNER = "user-merchant-1";
    private static final String AGGREGATE_TYPE = "Product";

    private ProductRepository products;
    private StockRepository stocks;
    private MerchantRepository merchants;
    private OutboxWriter outbox;
    private ProductService service;

    @BeforeEach
    void setUp() {
        products = mock(ProductRepository.class);
        stocks = mock(StockRepository.class);
        merchants = mock(MerchantRepository.class);
        outbox = mock(OutboxWriter.class);
        service = new ProductService(products, stocks, merchants, outbox);
    }

    private static Merchant merchant(String ownerUserId) {
        return Merchant.register(ownerUserId, "TechnoMart", "TechnoMart Store",
                "+77000000000", "shop@example.com", "Алматы");
    }

    private static CreateProductRequest createRequest(String currency, int initialStock) {
        return new CreateProductRequest("TECH-1", "Смартфон Samsung", "описание", "Электроника",
                "Samsung", 189_990_00L, currency, "https://img.example/a.jpg", initialStock);
    }

    @Nested
    @DisplayName("create")
    class Create {

        @Test
        void publishesTheOfferTogetherWithItsStockRow() {
            Merchant merchant = merchant(OWNER);
            when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.of(merchant));
            when(products.existsByMerchantIdAndSku(merchant.getId(), "TECH-1")).thenReturn(false);
            when(products.saveAndFlush(any(Product.class))).thenAnswer(call -> call.getArgument(0));
            when(stocks.save(any(Stock.class))).thenAnswer(call -> call.getArgument(0));

            ProductDetailResponse response = service.createProduct(OWNER, createRequest("kzt", 7));

            assertThat(response.title()).isEqualTo("Смартфон Samsung");
            assertThat(response.merchantId()).isEqualTo(merchant.getId());
            assertThat(response.merchant().name()).isEqualTo("TechnoMart");
            assertThat(response.currency()).isEqualTo("KZT");
            assertThat(response.priceMinor()).isEqualTo(189_990_00L);
            assertThat(response.status()).isEqualTo(ProductStatus.ACTIVE);
            assertThat(response.onHand()).isEqualTo(7);
            assertThat(response.reserved()).isZero();
            assertThat(response.available()).isEqualTo(7);

            ArgumentCaptor<ProductPublishedEvent> event = ArgumentCaptor.forClass(ProductPublishedEvent.class);
            verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.PRODUCT_PUBLISHED),
                    eq(AGGREGATE_TYPE), anyString(), anyLong(), event.capture());
            assertThat(event.getValue().currency()).isEqualTo("KZT");
            assertThat(event.getValue().category()).isEqualTo("Электроника");
        }

        @Test
        void defaultInitialStockIsZeroRatherThanNull() {
            Merchant merchant = merchant(OWNER);
            when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.of(merchant));
            when(products.saveAndFlush(any(Product.class))).thenAnswer(call -> call.getArgument(0));
            when(stocks.save(any(Stock.class))).thenAnswer(call -> call.getArgument(0));

            ProductDetailResponse response = service.createProduct(OWNER, new CreateProductRequest(
                    "TECH-2", "Наушники", null, "Электроника", null, 1_000L, "KZT", null, null));

            assertThat(response.onHand()).isZero();
            assertThat(response.available()).isZero();
        }

        @Test
        void aKnownSkuIsRejectedWithConflict() {
            Merchant merchant = merchant(OWNER);
            when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.of(merchant));
            when(products.existsByMerchantIdAndSku(merchant.getId(), "TECH-1")).thenReturn(true);

            assertThatThrownBy(() -> service.createProduct(OWNER, createRequest("KZT", 1)))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.DUPLICATE_SKU);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
                        assertThat(failure.details()).containsEntry("sku", "TECH-1");
                    });
            verify(products, never()).saveAndFlush(any(Product.class));
            verifyNoInteractions(outbox);
        }

        @Test
        void aLostRaceOnTheUniqueIndexBecomesTheSameConflict() {
            Merchant merchant = merchant(OWNER);
            when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.of(merchant));
            when(products.existsByMerchantIdAndSku(merchant.getId(), "TECH-1")).thenReturn(false);
            when(products.saveAndFlush(any(Product.class)))
                    .thenThrow(new DataIntegrityViolationException("uq_product_merchant_sku"));

            assertThatThrownBy(() -> service.createProduct(OWNER, createRequest("KZT", 1)))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.DUPLICATE_SKU));
        }

        @Test
        void aUserWithoutAMerchantProfileCannotPublish() {
            when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.createProduct(OWNER, createRequest("KZT", 1)))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.MERCHANT_NOT_FOUND));
            verifyNoInteractions(products);
        }

        @Test
        void anUnsupportedCurrencyIsAClientError() {
            Merchant merchant = merchant(OWNER);
            when(merchants.findByOwnerUserId(OWNER)).thenReturn(Optional.of(merchant));

            assertThatThrownBy(() -> service.createProduct(OWNER, createRequest("GBP", 1)))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CommonErrorCode.VALIDATION_FAILED));
        }
    }

    @Nested
    @DisplayName("update")
    class Update {

        private final Merchant owner = merchant(OWNER);
        private final Product product = Product.publish(owner.getId(), "TECH-1", "Смартфон", null,
                "Электроника", "Samsung", Currency.KZT, 100_000L, null);

        private void stubOwnership() {
            when(products.findById(product.getId())).thenReturn(Optional.of(product));
            when(merchants.findById(owner.getId())).thenReturn(Optional.of(owner));
        }

        @Test
        void anotherMerchantsProductIsForbidden() {
            Merchant intruder = merchant("user-merchant-2");
            when(products.findById(product.getId())).thenReturn(Optional.of(product));
            when(merchants.findById(product.getMerchantId())).thenReturn(Optional.of(owner));

            assertThatThrownBy(() -> service.updateProduct(intruder.getOwnerUserId(), product.getId(),
                    new UpdateProductRequest("Новое название", null, null, null, null, null, null, null)))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.NOT_MERCHANT_OWNER);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(403);
                    });
            assertThat(product.getTitle()).isEqualTo("Смартфон");
            verifyNoInteractions(outbox);
        }

        @Test
        void unknownProductIsNotFound() {
            when(products.findById("01J8ZCQ7Y4R3F0N5G8K2M9QW1Z")).thenReturn(Optional.empty());

            assertThatThrownBy(() -> service.updateProduct(OWNER, "01J8ZCQ7Y4R3F0N5G8K2M9QW1Z",
                    new UpdateProductRequest("x", null, null, null, null, null, null, null)))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.PRODUCT_NOT_FOUND));
        }

        @Test
        void aStockDeltaBelowReservedIsRejected() {
            Stock stock = Stock.withOnHand(product.getId(), 5);
            stock.reserve(4);
            stubOwnership();
            when(stocks.lockByProductId(product.getId())).thenReturn(Optional.of(stock));

            assertThatThrownBy(() -> service.updateProduct(OWNER, product.getId(),
                    new UpdateProductRequest(null, null, null, null, null, null, -2, "shrinkage")))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(422);
                    });
            assertThat(stock.getOnHand()).isEqualTo(5);
            assertThat(stock.getReserved()).isEqualTo(4);
        }

        @Test
        void aStockDeltaThatWouldGoNegativeIsRejected() {
            Stock stock = Stock.withOnHand(product.getId(), 2);
            stubOwnership();
            when(stocks.lockByProductId(product.getId())).thenReturn(Optional.of(stock));

            assertThatThrownBy(() -> service.updateProduct(OWNER, product.getId(),
                    new UpdateProductRequest(null, null, null, null, null, null, -5, "damaged")))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID));
            assertThat(stock.getOnHand()).isEqualTo(2);
        }

        @Test
        void aStockDeltaIsAppliedUnderALock() {
            Stock stock = Stock.withOnHand(product.getId(), 5);
            stock.reserve(1);
            stubOwnership();
            when(stocks.lockByProductId(product.getId())).thenReturn(Optional.of(stock));

            ProductDetailResponse response = service.updateProduct(OWNER, product.getId(),
                    new UpdateProductRequest("Смартфон Pro", "новое описание", "Электроника", "Samsung",
                            120_000L, null, 10, "restock"));

            assertThat(response.title()).isEqualTo("Смартфон Pro");
            assertThat(response.priceMinor()).isEqualTo(120_000L);
            assertThat(stock.getOnHand()).isEqualTo(15);
            assertThat(stock.getReserved()).isEqualTo(1);
            assertThat(response.onHand()).isEqualTo(15);
            assertThat(response.available()).isEqualTo(14);
            verify(stocks).lockByProductId(product.getId());
        }

        @Test
        void anUpdateWithoutAStockDeltaDoesNotLockStock() {
            stubOwnership();
            when(stocks.findById(product.getId())).thenReturn(Optional.of(Stock.withOnHand(product.getId(), 3)));

            ProductDetailResponse response = service.updateProduct(OWNER, product.getId(),
                    new UpdateProductRequest("Смартфон 2", null, null, null, null, null, null, null));

            assertThat(response.available()).isEqualTo(3);
            verify(stocks, never()).lockByProductId(anyString());
        }

        @Test
        void republishingADraftEmitsProductPublished() {
            product.changeStatus(ProductStatus.DRAFT);
            stubOwnership();
            when(stocks.findById(product.getId())).thenReturn(Optional.of(Stock.withOnHand(product.getId(), 1)));

            service.updateProduct(OWNER, product.getId(),
                    new UpdateProductRequest(null, null, null, null, null, ProductStatus.ACTIVE, null, null));

            verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.PRODUCT_PUBLISHED),
                    eq(AGGREGATE_TYPE), eq(product.getId()), anyLong(), any(ProductPublishedEvent.class));
        }

        @Test
        void anEditThatKeepsTheStatusPublishesNothing() {
            stubOwnership();
            when(stocks.findById(product.getId())).thenReturn(Optional.of(Stock.withOnHand(product.getId(), 1)));

            service.updateProduct(OWNER, product.getId(),
                    new UpdateProductRequest("Смартфон 3", null, null, null, null, null, null, null));

            verifyNoInteractions(outbox);
        }
    }
}
