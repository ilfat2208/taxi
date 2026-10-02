package kz.taxi.catalog.application;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import kz.taxi.catalog.api.dto.SupportMerchantResponse;
import kz.taxi.catalog.api.dto.SupportProductResponse;
import kz.taxi.catalog.api.dto.SupportReservationResponse;
import kz.taxi.catalog.api.dto.SupportStockResponse;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductStatus;
import kz.taxi.catalog.domain.ReservationStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.domain.StockReservation;
import kz.taxi.catalog.domain.SupportAuditRecord;
import kz.taxi.catalog.domain.SupportResourceType;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.StockReservationRepository;
import kz.taxi.catalog.infrastructure.SupportAuditRepository;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.web.PageResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

/**
 * The support read paths: what an agent is allowed to see, and what the audit trail
 * records about it.
 *
 * <p>The audit assertions are the point of this class. A support read that returned
 * data must leave <strong>exactly one</strong> row naming the actor and the resource,
 * and a lookup that found nothing must leave none — an audit table that records
 * failed probes fills up with guesses and stops being evidence.
 */
class SupportCatalogServiceTest {

    private static final String ACTOR = "agent-7";
    private static final String CORRELATION_ID = "corr-support-1";
    private static final String NO_SUCH_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW9Z";
    private static final String MERCHANT_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1V";

    private MerchantRepository merchants;
    private ProductRepository products;
    private StockRepository stocks;
    private StockReservationRepository reservations;
    private SupportAuditRepository auditRepository;
    private SimpleMeterRegistry registry;
    private SupportCatalogService service;

    @BeforeEach
    void setUp() {
        merchants = mock(MerchantRepository.class);
        products = mock(ProductRepository.class);
        stocks = mock(StockRepository.class);
        reservations = mock(StockReservationRepository.class);
        auditRepository = mock(SupportAuditRepository.class);
        registry = new SimpleMeterRegistry();
        service = new SupportCatalogService(merchants, products, stocks, reservations,
                new SupportAuditService(auditRepository), new SupportMetrics(registry));
        // The correlation id arrives with the request; the trail must carry it.
        CorrelationContext.set(CORRELATION_ID);
    }

    @AfterEach
    void tearDown() {
        CorrelationContext.clear();
        registry.close();
    }

    // ------------------------------------------------------------------ tests

    @Test
    @DisplayName("support reads another merchant's profile and the trail names who, what and when")
    void supportReadsAPeersMerchantProfileAndAuditsWhoWhatAndWhen() {
        Merchant merchant = merchant("user-9", "TechnoMart");
        when(merchants.findById(merchant.getId())).thenReturn(Optional.of(merchant));
        when(products.countByMerchantId(merchant.getId())).thenReturn(3L);

        SupportMerchantResponse response = service.merchantById(merchant.getId(), ACTOR);

        assertThat(response.ownerUserId()).isEqualTo("user-9");
        assertThat(response.phone()).isEqualTo("+77000000000");
        assertThat(response.productCount()).isEqualTo(3L);

        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getActorUserId()).isEqualTo(ACTOR);
        assertThat(row.getAction()).isEqualTo("catalog.support.merchant.read");
        assertThat(row.getEndpoint()).isEqualTo("GET /api/v1/support/merchants/{merchantId}");
        assertThat(row.getResourceType()).isEqualTo(SupportResourceType.MERCHANT.name());
        assertThat(row.getResourceId()).isEqualTo(merchant.getId());
        assertThat(row.getCorrelationId()).isEqualTo(CORRELATION_ID);
        assertThat(row.getCreatedAt()).isNotNull();

        assertThat(registry.get(SupportMetrics.SUPPORT_READ).tag("resource", "MERCHANT").counter().count())
                .isEqualTo(1d);
    }

    @Test
    @DisplayName("a shop is resolved from the user id the complaint is about")
    void aShopIsResolvedFromTheUserTheComplaintIsAbout() {
        Merchant merchant = merchant("user-9", "TechnoMart");
        when(merchants.findByOwnerUserId("user-9")).thenReturn(Optional.of(merchant));
        when(products.countByMerchantId(merchant.getId())).thenReturn(0L);

        SupportMerchantResponse response = service.merchantByOwnerUserId("user-9", ACTOR);

        assertThat(response.id()).isEqualTo(merchant.getId());
        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getAction()).isEqualTo("catalog.support.merchant.by-owner");
        // The row names the shop, not the user id that was typed: the trail is about
        // which merchant data was handed out.
        assertThat(row.getResourceId()).isEqualTo(merchant.getId());
        assertThat(row.getResourceType()).isEqualTo(SupportResourceType.MERCHANT.name());
    }

    @Test
    @DisplayName("the catalog list keeps drafts and explains why a customer cannot buy")
    void theCatalogListKeepsDraftsAndSaysWhyTheyCannotBeBought() {
        Merchant merchant = merchant("user-9", "TechnoMart");
        Product draft = product(merchant.getId(), ProductStatus.DRAFT);
        Product active = product(merchant.getId(), ProductStatus.ACTIVE);
        Stock draftStock = Stock.withOnHand(draft.getId(), 5);
        Stock activeStock = Stock.withOnHand(active.getId(), 3);
        activeStock.reserve(3);

        when(merchants.findById(merchant.getId())).thenReturn(Optional.of(merchant));
        when(products.findByMerchantIdAndStatusNot(eq(merchant.getId()), eq(ProductStatus.ARCHIVED),
                any(Pageable.class)))
                .thenReturn(page(List.of(draft, active)));
        when(products.findByMerchantId(eq(merchant.getId()), any(Pageable.class)))
                .thenReturn(page(List.of(draft, active)));
        when(stocks.findAllById(any())).thenReturn(List.of(draftStock, activeStock));

        PageResponse<SupportProductResponse> withDrafts =
                service.productsOfMerchant(merchant.getId(), false, 0, 20, ACTOR);
        PageResponse<SupportProductResponse> withArchived =
                service.productsOfMerchant(merchant.getId(), true, 0, 20, ACTOR);

        assertThat(withDrafts.items()).hasSize(2);
        SupportProductResponse draftRow = withDrafts.items().get(0);
        assertThat(draftRow.status()).isEqualTo(ProductStatus.DRAFT);
        assertThat(draftRow.sellable()).isFalse();
        assertThat(draftRow.buyable()).isFalse();
        assertThat(draftRow.available()).isEqualTo(5);
        assertThat(draftRow.unavailableReason()).contains("DRAFT");

        SupportProductResponse activeRow = withDrafts.items().get(1);
        assertThat(activeRow.status()).isEqualTo(ProductStatus.ACTIVE);
        assertThat(activeRow.sellable()).isTrue();
        assertThat(activeRow.buyable()).isFalse();
        assertThat(activeRow.onHand()).isEqualTo(3);
        assertThat(activeRow.reserved()).isEqualTo(3);
        assertThat(activeRow.unavailableReason()).contains("held by other checkouts");

        // The flag decides whether withdrawn offers are queried for at all.
        verify(products).findByMerchantId(eq(merchant.getId()), any(Pageable.class));
        assertThat(withArchived.items()).hasSize(2);

        SupportAuditRecord row = theSingleAuditRows(2).get(0);
        assertThat(row.getAction()).isEqualTo("catalog.support.merchant.products");
        assertThat(row.getResourceId()).isEqualTo(merchant.getId());
    }

    @Test
    @DisplayName("a withdrawn offer is still visible to support, with the reason spelled out")
    void aWithdrawnOfferIsStillVisibleToSupport() {
        Merchant merchant = merchant("user-9", "TechnoMart");
        Product archived = product(merchant.getId(), ProductStatus.ARCHIVED);
        when(products.findById(archived.getId())).thenReturn(Optional.of(archived));
        when(merchants.findById(merchant.getId())).thenReturn(Optional.of(merchant));
        when(stocks.findById(archived.getId())).thenReturn(Optional.of(Stock.withOnHand(archived.getId(), 4)));

        SupportProductResponse response = service.product(archived.getId(), ACTOR);

        assertThat(response.archived()).isTrue();
        assertThat(response.sellable()).isFalse();
        assertThat(response.buyable()).isFalse();
        assertThat(response.unavailableReason()).contains("ARCHIVED");
        assertThat(theSingleAuditRow().getResourceType()).isEqualTo(SupportResourceType.PRODUCT.name());
    }

    @Test
    @DisplayName("an unknown resource is a 404 and leaves no audit row")
    void anUnknownResourceIsNotFoundAndWritesNoAuditRow() {
        when(merchants.findById(NO_SUCH_ID)).thenReturn(Optional.empty());
        when(products.findById(NO_SUCH_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.merchantById(NO_SUCH_ID, ACTOR))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.MERCHANT_NOT_FOUND));
        assertThatThrownBy(() -> service.product(NO_SUCH_ID, ACTOR))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.PRODUCT_NOT_FOUND));

        // Nothing was handed out, so nothing is recorded: no row, no metric.
        verify(auditRepository, never()).save(any());
        assertThat(registry.find(SupportMetrics.SUPPORT_READ).counters()).isEmpty();
    }

    @Test
    @DisplayName("stock is reported with the holds that explain the counters")
    void stockIsReportedWithTheHoldsThatExplainTheCounters() {
        Merchant merchant = merchant("user-9", "TechnoMart");
        Product product = product(merchant.getId(), ProductStatus.ACTIVE);
        Stock stock = Stock.withOnHand(product.getId(), 4);
        stock.reserve(2);
        StockReservation hold = StockReservation.hold("01J8ZCQ7Y4R3F0N5G8K2M9QW2A",
                product.getId(), 2, Instant.now().plusSeconds(600));

        when(products.findById(product.getId())).thenReturn(Optional.of(product));
        when(stocks.findById(product.getId())).thenReturn(Optional.of(stock));
        when(reservations.findByProductIdOrderByCreatedAtDesc(eq(product.getId()), any(Pageable.class)))
                .thenReturn(List.of(hold));

        SupportStockResponse response = service.stock(product.getId(), ACTOR);

        assertThat(response.onHand()).isEqualTo(4);
        assertThat(response.reserved()).isEqualTo(2);
        assertThat(response.available()).isEqualTo(2);
        assertThat(response.holds()).singleElement().satisfies(line -> {
            assertThat(line.orderId()).isEqualTo("01J8ZCQ7Y4R3F0N5G8K2M9QW2A");
            assertThat(line.quantity()).isEqualTo(2);
            assertThat(line.status()).isEqualTo(ReservationStatus.ACTIVE);
        });

        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getResourceType()).isEqualTo(SupportResourceType.STOCK.name());
        assertThat(row.getResourceId()).isEqualTo(product.getId());
        assertThat(registry.get(SupportMetrics.SUPPORT_READ).tag("resource", "STOCK").counter().count())
                .isEqualTo(1d);
    }

    @Test
    @DisplayName("a checkout this service never reserved for is a 404, while a real one is audited once")
    void aCheckoutWithoutHoldsIsNotFoundWhileEveryHoldOfAnotherIsAuditedOnce() {
        when(reservations.findByOrderIdOrderByProductIdAsc("order-unknown")).thenReturn(List.of());

        assertThatThrownBy(() -> service.reservationsOfOrder("order-unknown", ACTOR))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.RESERVATION_NOT_FOUND));
        verify(auditRepository, never()).save(any());

        Product product = product(MERCHANT_ID, ProductStatus.ACTIVE);
        when(reservations.findByOrderIdOrderByProductIdAsc("order-1")).thenReturn(List.of(
                StockReservation.hold("order-1", product.getId(), 1, Instant.now().plusSeconds(600)),
                StockReservation.hold("order-1", "01J8ZCQ7Y4R3F0N5G8K2M9QW3B", 2, null)));

        List<SupportReservationResponse> holds = service.reservationsOfOrder("order-1", ACTOR);

        assertThat(holds).hasSize(2);
        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getAction()).isEqualTo("catalog.support.reservation.list");
        assertThat(row.getResourceType()).isEqualTo(SupportResourceType.RESERVATION.name());
        assertThat(row.getResourceId()).isEqualTo("order-1");
    }

    // ------------------------------------------------------------------ helpers

    private static Merchant merchant(String ownerUserId, String name) {
        return Merchant.register(ownerUserId, name, name + " Store", "+77000000000",
                "shop@example.com", "Алматы");
    }

    private static Product product(String merchantId, ProductStatus status) {
        Product product = Product.publish(merchantId, "SKU-" + status, "Смартфон", null,
                "Электроника", "Samsung", Currency.KZT, 189_990_00L, null);
        product.changeStatus(status);
        return product;
    }

    private static Page<Product> page(List<Product> items) {
        return new PageImpl<>(items);
    }

    /** Asserts the read wrote exactly one row and returns it. */
    private SupportAuditRecord theSingleAuditRow() {
        return theSingleAuditRows(1).get(0);
    }

    private List<SupportAuditRecord> theSingleAuditRows(int expected) {
        ArgumentCaptor<SupportAuditRecord> captor = ArgumentCaptor.forClass(SupportAuditRecord.class);
        verify(auditRepository, times(expected)).save(captor.capture());
        return captor.getAllValues();
    }
}
