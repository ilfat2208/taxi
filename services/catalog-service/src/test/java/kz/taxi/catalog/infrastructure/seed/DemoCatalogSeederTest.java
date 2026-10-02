package kz.taxi.catalog.infrastructure.seed;

import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Demo data is a convenience, never a reason for a service not to start.
 *
 * <p>These tests pin the two properties that matter in production: the seeder stays
 * out of a populated database, and a failure while seeding is swallowed (the
 * service starts with an empty catalog and logs a warning).
 */
class DemoCatalogSeederTest {

    private MerchantRepository merchants;
    private ProductRepository products;
    private StockRepository stocks;
    private OutboxWriter outbox;
    private PlatformTransactionManager transactionManager;

    @BeforeEach
    void setUp() {
        merchants = mock(MerchantRepository.class);
        products = mock(ProductRepository.class);
        stocks = mock(StockRepository.class);
        outbox = mock(OutboxWriter.class);
        transactionManager = mock(PlatformTransactionManager.class);
    }

    private DemoCatalogSeeder seeder(boolean enabled) {
        return new DemoCatalogSeeder(merchants, products, stocks, outbox, transactionManager, enabled);
    }

    @Test
    void seedsThreeMerchantsAndTwelveProductsOnAnEmptyCatalog() {
        when(products.count()).thenReturn(0L);
        when(merchants.save(any(Merchant.class))).thenAnswer(call -> call.getArgument(0));
        when(products.save(any(Product.class))).thenAnswer(call -> call.getArgument(0));
        when(stocks.save(any(Stock.class))).thenAnswer(call -> call.getArgument(0));

        seeder(true).run(null);

        verify(merchants, times(3)).save(any(Merchant.class));
        verify(products, times(12)).save(any(Product.class));
        verify(stocks, times(12)).save(any(Stock.class));
        verify(outbox, times(12)).append(eq(KafkaTopics.CATALOG_EVENTS),
                eq(KafkaTopics.Events.PRODUCT_PUBLISHED), eq("Product"), anyString(), anyLong(), any());
    }

    @Test
    void neverTouchesACatalogThatAlreadyHasProducts() {
        when(products.count()).thenReturn(4L);

        seeder(true).run(null);

        verifyNoInteractions(merchants);
        verifyNoInteractions(stocks);
        verifyNoInteractions(outbox);
    }

    @Test
    void doesNothingWhenDisabled() {
        seeder(false).run(null);

        verifyNoInteractions(products);
        verifyNoInteractions(merchants);
    }

    @Test
    void aFailingSeedNeverFailsStartup() {
        when(products.count()).thenThrow(new IllegalStateException("database is not reachable"));

        assertThatCode(() -> seeder(true).run(null)).doesNotThrowAnyException();
        verify(merchants, never()).save(any(Merchant.class));
    }
}
