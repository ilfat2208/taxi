package kz.taxi.catalog;

import kz.taxi.catalog.api.dto.ReservationResponse;
import kz.taxi.catalog.api.dto.ReserveStockItemRequest;
import kz.taxi.catalog.api.dto.ReserveStockRequest;
import kz.taxi.catalog.application.CatalogQueryService;
import kz.taxi.catalog.application.StockReservationService;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductSort;
import kz.taxi.catalog.domain.ReservationStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.ProductSearchCriteria;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.catalog.api.dto.ProductSummaryResponse;
import kz.taxi.catalog.support.ItInfrastructure;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end tests against a real PostgreSQL 16.
 *
 * <p>Three things cannot be proven with mocks and are the reason this test exists:
 * <ol>
 *   <li>the Flyway migration and the entity mappings agree (Hibernate runs with
 *       {@code ddl-auto: validate}, the generated {@code search_vector} column
 *       included);</li>
 *   <li>full-text search really works — {@code websearch_to_tsquery}, {@code ts_rank}
 *       and the GIN index exist only inside Postgres;</li>
 *   <li>pessimistic row locking serializes two simultaneous buyers, which is a
 *       property of {@code SELECT ... FOR UPDATE} and of nothing else in this
 *       service.</li>
 * </ol>
 *
 * <p>Runs only under {@code mvn verify -Pintegration} (surefire does not pick up
 * {@code *IT}) and needs either Docker or, when {@code IT_DATABASE_URL} is set, the
 * database it points at. {@link ItInfrastructure} explains that choice: CI starts the
 * {@code postgres:16-alpine} container exactly as before, a developer machine that runs
 * the compose stack uses {@code scripts/it-local.ps1} and starts none. Either way
 * Flyway migrates the database, so it has to be a test one — and
 * {@link #cleanCatalog()} empties it before every scenario, which is what keeps a
 * long-lived external database equivalent to the fresh container.
 */
@EnabledIf(ItInfrastructure.AVAILABLE_METHOD)
@SpringBootTest(properties = {
        // Deterministic data: the demo seeder must not race the fixtures, and the
        // outbox relay must not publish while the test asserts on outbox rows.
        "taxi.demo.seed=false",
        "taxi.outbox.enabled=false",
        // Keep the scheduled expiry job out of the way; expiry is called directly.
        "taxi.catalog.expiry-scan-interval-ms=21600000",
        "taxi.catalog.expiry-initial-delay-ms=21600000",
        // No broker is started here, so let the topic admin give up quickly instead
        // of blocking context startup for the default timeout.
        "spring.kafka.admin.properties.default.api.timeout.ms=2000",
        "spring.kafka.admin.properties.request.timeout.ms=2000"
})
class CatalogReservationIT {

    private static final String ORDER_A = "01J8ZCQ7Y4R3F0N5G8K2M9QWA1";
    private static final String ORDER_B = "01J8ZCQ7Y4R3F0N5G8K2M9QWB2";

    /**
     * Started by {@link ItInfrastructure#start} <em>unless</em> {@code IT_DATABASE_URL}
     * points the test at an already-running database; never referenced before the
     * {@code @EnabledIf} condition above has passed. The database name is kept as it was
     * so that the container path stays byte-for-byte what CI has always started.
     */
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"))
                    .withDatabaseName("taxi_catalog");

    private static final ItInfrastructure INFRASTRUCTURE = ItInfrastructure.start(POSTGRES);

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        INFRASTRUCTURE.register(registry);
    }

    @Autowired
    private StockReservationService reservations;
    @Autowired
    private CatalogQueryService catalog;
    @Autowired
    private MerchantRepository merchants;
    @Autowired
    private ProductRepository products;
    @Autowired
    private StockRepository stocks;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private JdbcTemplate jdbc;

    @BeforeEach
    void cleanCatalog() {
        // Deletion order follows the foreign keys; the container is per class, so
        // every test starts from an empty catalog instead of from its neighbours.
        jdbc.execute("delete from catalog.outbox_message");
        jdbc.execute("delete from catalog.stock_reservation");
        jdbc.execute("delete from catalog.stock");
        jdbc.execute("delete from catalog.product");
        jdbc.execute("delete from catalog.merchant");
    }

    @Test
    @DisplayName("Flyway created the catalog schema and Hibernate could validate against it")
    void flywayMigrationCreatedTheCatalogSchema() {
        Integer tables = jdbc.queryForObject("""
                select count(*) from information_schema.tables
                where table_schema = 'catalog'
                  and table_name in ('merchant', 'product', 'stock', 'stock_reservation', 'outbox_message')
                """, Integer.class);

        assertThat(tables).isEqualTo(5);
        assertThat(jdbc.queryForObject("select count(*) from catalog.flyway_schema_history", Integer.class))
                .isPositive();
        // The search column is generated by the database, never written by the entity.
        assertThat(jdbc.queryForObject("""
                select is_generated from information_schema.columns
                where table_schema = 'catalog' and table_name = 'product' and column_name = 'search_vector'
                """, String.class)).isEqualTo("ALWAYS");
    }

    @Test
    @DisplayName("two buyers race for the last unit: one holds it, the other is refused, then it is committed")
    void concurrentSecondReservationOfTheLastUnitIsRejectedThenTheFirstIsCommitted() throws Exception {
        Product product = seedProduct("TECH-1", "Смартфон Samsung Galaxy A55", "Электроника", 1, 189_990_00L);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        CountDownLatch firstBuyerHoldsStock = new CountDownLatch(1);
        CountDownLatch firstBuyerMayFinish = new CountDownLatch(1);
        CountDownLatch secondBuyerStarted = new CountDownLatch(1);
        ExecutorService buyers = Executors.newFixedThreadPool(2);

        try {
            // First buyer: reserve, then keep the transaction open so the row lock is
            // still held while the second buyer tries the same product.
            Future<ReservationResponse> firstBuyer = buyers.submit(() -> transaction.execute(status -> {
                ReservationResponse response = reservations.reserve(reserve(ORDER_A, product.getId(), 1));
                firstBuyerHoldsStock.countDown();
                awaitOrFail(firstBuyerMayFinish, "first buyer was never released");
                return response;
            }));
            assertThat(firstBuyerHoldsStock.await(30, TimeUnit.SECONDS)).isTrue();

            Future<Object> secondBuyer = buyers.submit(() -> {
                secondBuyerStarted.countDown();
                try {
                    return reservations.reserve(reserve(ORDER_B, product.getId(), 1));
                } catch (RuntimeException failure) {
                    return failure;
                }
            });
            assertThat(secondBuyerStarted.await(30, TimeUnit.SECONDS)).isTrue();
            // Give the second buyer time to reach the row lock. Without the pause the
            // test would still pass, but it would not exercise the blocking path it
            // is meant to exercise.
            Thread.sleep(500);

            firstBuyerMayFinish.countDown();

            assertThat(firstBuyer.get(30, TimeUnit.SECONDS).status()).isEqualTo(ReservationStatus.ACTIVE);
            Object secondBuyerOutcome = secondBuyer.get(60, TimeUnit.SECONDS);
            assertThat(secondBuyerOutcome).isInstanceOfSatisfying(DomainException.class, failure -> {
                assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.INSUFFICIENT_STOCK);
                assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
            });

            // Exactly one unit was held, and nobody else got anything.
            assertThat(jdbc.queryForObject(
                    "select reserved from catalog.stock where product_id = ?", Integer.class, product.getId()))
                    .isEqualTo(1);
            assertThat(jdbc.queryForObject(
                    "select count(*) from catalog.stock_reservation where product_id = ?", Integer.class,
                    product.getId())).isEqualTo(1);

            ReservationResponse committed = reservations.commit(ORDER_A);

            assertThat(committed.status()).isEqualTo(ReservationStatus.COMMITTED);
            assertThat(committed.subtotalMinor()).isEqualTo(189_990_00L);
            assertThat(jdbc.queryForObject(
                    "select on_hand from catalog.stock where product_id = ?", Integer.class, product.getId()))
                    .isZero();
            assertThat(jdbc.queryForObject(
                    "select reserved from catalog.stock where product_id = ?", Integer.class, product.getId()))
                    .isZero();

            // The outbox got one row per fact, in the transaction that made the change.
            assertThat(eventCount("stock.reserved", ORDER_A)).isEqualTo(1);
            assertThat(eventCount("stock.committed", ORDER_A)).isEqualTo(1);

            // Repeating the commit answers with the stored state and moves nothing.
            assertThat(reservations.commit(ORDER_A).status()).isEqualTo(ReservationStatus.COMMITTED);
            assertThat(eventCount("stock.committed", ORDER_A)).isEqualTo(1);

            // And the spent order cannot reserve again under the same id.
            assertThat(reservations.reserve(reserve(ORDER_A, product.getId(), 1)).status())
                    .isEqualTo(ReservationStatus.COMMITTED);
        } finally {
            firstBuyerMayFinish.countDown();
            buyers.shutdownNow();
        }
    }

    @Test
    @DisplayName("an overdue reservation gives its stock back on the real database")
    void expiryReturnsStockOfAnOverdueReservation() {
        Product product = seedProduct("TECH-2", "Наушники JBL Tune 510BT", "Электроника", 3, 2_499_000L);
        reservations.reserve(reserve(ORDER_A, product.getId(), 2));

        assertThat(stockColumn(product.getId(), "reserved")).isEqualTo(2);
        // Backdate the hold: the TTL property cannot produce a past deadline on demand.
        jdbc.update("update catalog.stock_reservation set expires_at = now() - interval '5 minutes' where order_id = ?",
                ORDER_A);

        int expired = reservations.expireOverdue();

        assertThat(expired).isEqualTo(1);
        assertThat(stockColumn(product.getId(), "reserved")).isZero();
        assertThat(stockColumn(product.getId(), "on_hand")).isEqualTo(3);
        assertThat(jdbc.queryForObject(
                "select status from catalog.stock_reservation where order_id = ?", String.class, ORDER_A))
                .isEqualTo("EXPIRED");
        assertThat(eventCount("stock.released", ORDER_A)).isEqualTo(1);

        // Expiring twice must not hand the same units back twice.
        assertThat(reservations.expireOverdue()).isZero();
        assertThat(stockColumn(product.getId(), "on_hand")).isEqualTo(3);
    }

    @Test
    @DisplayName("full-text search finds a seeded product through the generated tsvector column")
    void fullTextSearchReturnsTheSeededProduct() {
        Product smartphone = seedProduct("TECH-3", "Смартфон Samsung Galaxy A55 128GB", "Электроника",
                4, 189_990_00L);
        seedProduct("HOME-1", "Кофемашина DeLonghi ECAM 22.110", "Бытовая техника", 5, 38_990_00L);
        seedProduct("BEAUTY-1", "Крем для лица La Roche-Posay", "Красота", 6, 989_000L);

        PageResponse<ProductSummaryResponse> hits = catalog.searchProducts(
                ProductSearchCriteria.of("смартфон samsung", null, null, null, null),
                ProductSort.RELEVANCE, 0, 20);

        assertThat(hits.totalElements()).isEqualTo(1);
        assertThat(hits.items()).singleElement().satisfies(summary -> {
            assertThat(summary.id()).isEqualTo(smartphone.getId());
            assertThat(summary.title()).contains("Galaxy A55");
            assertThat(summary.availableQuantity()).isEqualTo(4);
            assertThat(summary.priceMinor()).isEqualTo(189_990_00L);
        });

        // The count query pages independently of the fetched slice.
        PageResponse<ProductSummaryResponse> firstPage = catalog.searchProducts(
                ProductSearchCriteria.of(null, null, null, null, null), ProductSort.PRICE_ASC, 0, 1);
        assertThat(firstPage.totalElements()).isEqualTo(3);
        assertThat(firstPage.items()).hasSize(1);
        assertThat(firstPage.hasNext()).isTrue();
        assertThat(firstPage.totalPages()).isEqualTo(3);
        assertThat(firstPage.items().get(0).title()).contains("La Roche-Posay");

        // Category and price filters run alongside the text search.
        assertThat(catalog.searchProducts(
                ProductSearchCriteria.of(null, "Электроника", null, 100_000_00L, null),
                ProductSort.NEWEST, 0, 20).totalElements()).isEqualTo(1);
        assertThat(catalog.listCategories())
                .containsExactlyInAnyOrder("Бытовая техника", "Красота", "Электроника");

        // A word nobody sells is not a match.
        assertThat(catalog.searchProducts(
                ProductSearchCriteria.of("вертолёт", null, null, null, null),
                ProductSort.RELEVANCE, 0, 20).totalElements()).isZero();
    }

    // ------------------------------------------------------------------ fixtures

    private Product seedProduct(String sku, String title, String category, int onHand, long priceMinor) {
        Merchant merchant = merchants.save(Merchant.register("demo-merchant-" + sku, "Demo " + sku,
                null, null, null, "Алматы"));
        Product product = products.save(Product.publish(merchant.getId(), sku, title,
                "seed data for the integration test", category, "DemoBrand", Currency.KZT, priceMinor, null));
        stocks.save(Stock.withOnHand(product.getId(), onHand));
        return product;
    }

    private static ReserveStockRequest reserve(String orderId, String productId, int quantity) {
        return new ReserveStockRequest(orderId, List.of(new ReserveStockItemRequest(productId, quantity)));
    }

    private int stockColumn(String productId, String column) {
        Integer value = jdbc.queryForObject(
                "select " + column + " from catalog.stock where product_id = ?", Integer.class, productId);
        return value == null ? 0 : value;
    }

    private int eventCount(String eventType, String aggregateId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from catalog.outbox_message
                where event_type = ? and aggregate_id = ?
                """, Integer.class, eventType, aggregateId);
        return count == null ? 0 : count;
    }

    private static void awaitOrFail(CountDownLatch latch, String message) {
        try {
            if (!latch.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException(message);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }
}
