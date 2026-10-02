package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.ReservationResponse;
import kz.taxi.catalog.api.dto.ReserveStockItemRequest;
import kz.taxi.catalog.api.dto.ReserveStockRequest;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ReservationStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.domain.StockReservation;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.StockReservationRepository;
import kz.taxi.catalog.infrastructure.config.CatalogProperties;
import kz.taxi.catalog.infrastructure.events.StockCommittedEvent;
import kz.taxi.catalog.infrastructure.events.StockReleasedEvent;
import kz.taxi.catalog.infrastructure.events.StockReservedEvent;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests of the reservation use cases.
 *
 * <p>They assert the state machine and the money, not the plumbing: what the two
 * stock counters look like after each call, that a retry cannot move them twice,
 * and that every rejection carries the error code a caller can switch on.
 */
class StockReservationServiceTest {

    private static final String ORDER_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1T";
    private static final String OTHER_ORDER_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1U";
    private static final String AGGREGATE_TYPE = "StockReservation";

    private ProductRepository products;
    private StockRepository stocks;
    private StockReservationRepository reservations;
    private OutboxWriter outbox;
    private StockReservationService service;

    @BeforeEach
    void setUp() {
        products = mock(ProductRepository.class);
        stocks = mock(StockRepository.class);
        reservations = mock(StockReservationRepository.class);
        outbox = mock(OutboxWriter.class);
        service = new StockReservationService(products, stocks, reservations, outbox,
                new CatalogProperties(Duration.ofMinutes(30)));
    }

    // ------------------------------------------------------------------ fixtures

    private static Product product(String sku, long priceMinor, Currency currency) {
        return Product.publish("M-1", sku, "Товар " + sku, "описание", "Электроника", "Brand",
                currency, priceMinor, null);
    }

    private void stubFreshOrder() {
        when(reservations.findByOrderIdOrderByProductIdAsc(anyString())).thenReturn(List.of());
    }

    private void stubCatalogue(Product... catalogue) {
        when(products.findAllById(anyList())).thenReturn(List.of(catalogue));
    }

    private void stubLockedStock(Stock... locked) {
        when(stocks.lockAllByProductIdIn(anyList())).thenReturn(List.of(locked));
    }

    private static ReserveStockRequest reserve(String orderId, String productId, Integer quantity) {
        return new ReserveStockRequest(orderId, List.of(new ReserveStockItemRequest(productId, quantity)));
    }

    // ------------------------------------------------------------------ reserve

    @Nested
    @DisplayName("reserve")
    class Reserve {

        @Test
        void holdsStockWithoutShippingItAndPublishesTheEvent() {
            Product product = product("TECH-1", 189_990_00L, Currency.KZT);
            Stock stock = Stock.withOnHand(product.getId(), 5);
            stubFreshOrder();
            stubCatalogue(product);
            stubLockedStock(stock);

            ReservationResponse response = service.reserve(reserve(ORDER_ID, product.getId(), 2));

            assertThat(stock.getReserved()).isEqualTo(2);
            assertThat(stock.getOnHand()).isEqualTo(5);
            assertThat(stock.available()).isEqualTo(3);

            assertThat(response.orderId()).isEqualTo(ORDER_ID);
            assertThat(response.status()).isEqualTo(ReservationStatus.ACTIVE);
            assertThat(response.currency()).isEqualTo("KZT");
            assertThat(response.subtotalMinor()).isEqualTo(2 * 189_990_00L);
            assertThat(response.expiresAt()).isAfter(Instant.now());
            assertThat(response.items()).singleElement().satisfies(line -> {
                assertThat(line.productId()).isEqualTo(product.getId());
                assertThat(line.merchantId()).isEqualTo("M-1");
                assertThat(line.quantity()).isEqualTo(2);
                assertThat(line.unitPriceMinor()).isEqualTo(189_990_00L);
                assertThat(line.lineTotalMinor()).isEqualTo(2 * 189_990_00L);
                assertThat(line.currency()).isEqualTo("KZT");
            });

            verify(reservations).saveAll(anyList());
            ArgumentCaptor<StockReservedEvent> event = ArgumentCaptor.forClass(StockReservedEvent.class);
            verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.STOCK_RESERVED),
                    eq(AGGREGATE_TYPE), eq(ORDER_ID), anyLong(), event.capture());
            assertThat(event.getValue().subtotalMinor()).isEqualTo(2 * 189_990_00L);
            assertThat(event.getValue().currency()).isEqualTo("KZT");
            assertThat(event.getValue().items()).hasSize(1);
        }

        @Test
        void aSecondCallWithTheSameOrderIdReturnsTheStoredReservationUntouched() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            StockReservation stored = StockReservation.hold(ORDER_ID, product.getId(), 3,
                    Instant.now().plus(Duration.ofMinutes(20)));
            when(reservations.findByOrderIdOrderByProductIdAsc(ORDER_ID)).thenReturn(List.of(stored));
            stubCatalogue(product);

            ReservationResponse response = service.reserve(reserve(ORDER_ID, product.getId(), 3));

            assertThat(response.orderId()).isEqualTo(ORDER_ID);
            assertThat(response.status()).isEqualTo(ReservationStatus.ACTIVE);
            assertThat(response.items()).singleElement()
                    .satisfies(line -> assertThat(line.quantity()).isEqualTo(3));
            // The whole point of idempotency: no second hold, no second movement, no
            // second event. Nothing but reads happened.
            verifyNoInteractions(stocks);
            verifyNoInteractions(outbox);
            verify(reservations, never()).saveAll(anyList());
        }

        @Test
        void aStoredReservationIsReplayedEvenAfterItWasCommitted() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            StockReservation stored = StockReservation.hold(ORDER_ID, product.getId(), 1, null);
            stored.commit();
            when(reservations.findByOrderIdOrderByProductIdAsc(ORDER_ID)).thenReturn(List.of(stored));
            stubCatalogue(product);

            assertThat(service.reserve(reserve(ORDER_ID, product.getId(), 1)).status())
                    .isEqualTo(ReservationStatus.COMMITTED);
            verifyNoInteractions(stocks);
        }

        @Test
        void rejectsTheSecondBuyerOfTheLastUnit() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            Stock stock = Stock.withOnHand(product.getId(), 1);
            stubFreshOrder();
            stubCatalogue(product);
            stubLockedStock(stock);

            assertThat(service.reserve(reserve(ORDER_ID, product.getId(), 1)).items()).hasSize(1);
            assertThat(stock.available()).isZero();

            assertThatThrownBy(() -> service.reserve(reserve(OTHER_ORDER_ID, product.getId(), 1)))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.INSUFFICIENT_STOCK);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
                        assertThat(failure.details()).containsEntry("available", 0)
                                .containsEntry("requested", 1);
                    });
            assertThat(stock.getReserved()).isEqualTo(1);
            assertThat(stock.getOnHand()).isEqualTo(1);
        }

        @Test
        void acceptsExactlyTheAvailableQuantity() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            Stock stock = Stock.withOnHand(product.getId(), 2);
            stock.reserve(1);
            stubFreshOrder();
            stubCatalogue(product);
            stubLockedStock(stock);

            assertThat(service.reserve(reserve(ORDER_ID, product.getId(), 1)).subtotalMinor())
                    .isEqualTo(100_000L);
            assertThat(stock.available()).isZero();
        }

        @Test
        void unknownProductIsNotFound() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            stubFreshOrder();
            when(products.findAllById(anyList())).thenReturn(List.of());

            assertThatThrownBy(() -> service.reserve(reserve(ORDER_ID, product.getId(), 1)))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.PRODUCT_NOT_FOUND));
            verifyNoInteractions(stocks);
        }

        @Test
        void archivedProductIsAConflictNotAMissingOne() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            product.changeStatus(kz.taxi.catalog.domain.ProductStatus.ARCHIVED);
            stubFreshOrder();
            stubCatalogue(product);

            assertThatThrownBy(() -> service.reserve(reserve(ORDER_ID, product.getId(), 1)))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.PRODUCT_NOT_AVAILABLE));
            verifyNoInteractions(stocks);
        }

        @Test
        void oneReservationCannotMixCurrencies() {
            Product tenge = product("TECH-1", 100_000L, Currency.KZT);
            Product dollar = product("TECH-2", 2_000L, Currency.USD);
            stubFreshOrder();
            stubCatalogue(tenge, dollar);

            assertThatThrownBy(() -> service.reserve(new ReserveStockRequest(ORDER_ID, List.of(
                    new ReserveStockItemRequest(tenge.getId(), 1),
                    new ReserveStockItemRequest(dollar.getId(), 1)))))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.MIXED_CURRENCIES);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(400);
                        assertThat(failure.details()).containsKey("currencies");
                    });
            verifyNoInteractions(stocks);
        }

        @Test
        void quantityOutsideOneToNinetyNineIsRejected() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            stubFreshOrder();
            stubCatalogue(product);

            for (Integer quantity : new Integer[] {null, 0, -1, 100}) {
                assertThatThrownBy(() -> service.reserve(reserve(ORDER_ID, product.getId(), quantity)))
                        .isInstanceOfSatisfying(DomainException.class, failure -> {
                            assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.INVALID_QUANTITY);
                            assertThat(failure.errorCode().httpStatus()).isEqualTo(400);
                        });
            }
            verifyNoInteractions(stocks);
        }

        @Test
        void aProductCannotAppearTwiceInOneReservation() {
            Product product = product("TECH-1", 100_000L, Currency.KZT);
            stubFreshOrder();
            stubCatalogue(product);

            assertThatThrownBy(() -> service.reserve(new ReserveStockRequest(ORDER_ID, List.of(
                    new ReserveStockItemRequest(product.getId(), 1),
                    new ReserveStockItemRequest(product.getId(), 2)))))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.INVALID_QUANTITY));
            verifyNoInteractions(stocks);
        }
    }

    // ------------------------------------------------------------------ commit

    @Nested
    @DisplayName("commit")
    class Commit {

        @Test
        void takesTheGoodsOutOfStockAndPublishesTheEvent() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            Stock stock = Stock.withOnHand(product.getId(), 5);
            stock.reserve(2);
            StockReservation hold = StockReservation.hold(ORDER_ID, product.getId(), 2,
                    Instant.now().plus(Duration.ofMinutes(10)));
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(hold));
            stubCatalogue(product);
            stubLockedStock(stock);

            ReservationResponse response = service.commit(ORDER_ID);

            assertThat(stock.getOnHand()).isEqualTo(3);
            assertThat(stock.getReserved()).isZero();
            assertThat(hold.getStatus()).isEqualTo(ReservationStatus.COMMITTED);
            assertThat(response.status()).isEqualTo(ReservationStatus.COMMITTED);
            assertThat(response.subtotalMinor()).isEqualTo(500_000L);

            ArgumentCaptor<StockCommittedEvent> event = ArgumentCaptor.forClass(StockCommittedEvent.class);
            verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.STOCK_COMMITTED),
                    eq(AGGREGATE_TYPE), eq(ORDER_ID), anyLong(), event.capture());
            assertThat(event.getValue().items()).singleElement()
                    .satisfies(line -> assertThat(line.lineTotalMinor()).isEqualTo(500_000L));
        }

        @Test
        void committingTwiceMovesStockOnce() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            StockReservation committed = StockReservation.hold(ORDER_ID, product.getId(), 2, null);
            committed.commit();
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(committed));
            stubCatalogue(product);

            ReservationResponse response = service.commit(ORDER_ID);

            assertThat(response.status()).isEqualTo(ReservationStatus.COMMITTED);
            verifyNoInteractions(stocks);
            verifyNoInteractions(outbox);
        }

        @Test
        void anExpiredReservationCannotBeCommitted() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            StockReservation expired = StockReservation.hold(ORDER_ID, product.getId(), 2, null);
            expired.expire();
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(expired));

            assertThatThrownBy(() -> service.commit(ORDER_ID))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.RESERVATION_NOT_ACTIVE);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
                        assertThat(failure.details()).containsEntry("status", "EXPIRED");
                    });
            verifyNoInteractions(stocks);
        }

        @Test
        void unknownOrderHasNoReservation() {
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of());

            assertThatThrownBy(() -> service.commit(ORDER_ID))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.RESERVATION_NOT_FOUND));
        }
    }

    // ------------------------------------------------------------------ release

    @Nested
    @DisplayName("release")
    class Release {

        @Test
        void returnsOnlyThePromiseAndPublishesTheReason() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            Stock stock = Stock.withOnHand(product.getId(), 5);
            stock.reserve(2);
            StockReservation hold = StockReservation.hold(ORDER_ID, product.getId(), 2,
                    Instant.now().plus(Duration.ofMinutes(10)));
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(hold));
            stubCatalogue(product);
            stubLockedStock(stock);

            ReservationResponse response = service.release(ORDER_ID, StockReleasedEvent.REASON_ABANDONED);

            assertThat(stock.getOnHand()).isEqualTo(5);
            assertThat(stock.getReserved()).isZero();
            assertThat(stock.available()).isEqualTo(5);
            assertThat(hold.getStatus()).isEqualTo(ReservationStatus.RELEASED);
            assertThat(response.status()).isEqualTo(ReservationStatus.RELEASED);

            ArgumentCaptor<StockReleasedEvent> event = ArgumentCaptor.forClass(StockReleasedEvent.class);
            verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.STOCK_RELEASED),
                    eq(AGGREGATE_TYPE), eq(ORDER_ID), anyLong(), event.capture());
            assertThat(event.getValue().reason()).isEqualTo(StockReleasedEvent.REASON_ABANDONED);
        }

        @Test
        void releasingTwiceReturnsTheStoredStateWithoutTouchingStock() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            StockReservation released = StockReservation.hold(ORDER_ID, product.getId(), 2, null);
            released.release();
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(released));
            stubCatalogue(product);

            assertThat(service.release(ORDER_ID, "abandoned").status()).isEqualTo(ReservationStatus.RELEASED);
            verifyNoInteractions(stocks);
            verifyNoInteractions(outbox);
        }

        @Test
        void aReservationTheExpiryJobAlreadyReturnedIsAnsweredWithItsStoredState() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            StockReservation expired = StockReservation.hold(ORDER_ID, product.getId(), 2, null);
            expired.expire();
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(expired));
            stubCatalogue(product);

            ReservationResponse response = service.release(ORDER_ID, null);

            assertThat(response.status()).isEqualTo(ReservationStatus.EXPIRED);
            // Releasing an already-expired hold would subtract the quantity a second
            // time — the single most expensive mistake this method can make.
            verifyNoInteractions(stocks);
        }

        @Test
        void aCommittedReservationCannotBeReleased() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            StockReservation committed = StockReservation.hold(ORDER_ID, product.getId(), 2, null);
            committed.commit();
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(committed));

            assertThatThrownBy(() -> service.release(ORDER_ID, "too late"))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.RESERVATION_NOT_ACTIVE));
            verifyNoInteractions(stocks);
        }

        @Test
        void anEmptyReasonIsRecordedAsUnspecified() {
            Product product = product("TECH-1", 250_000L, Currency.KZT);
            Stock stock = Stock.withOnHand(product.getId(), 3);
            stock.reserve(1);
            StockReservation hold = StockReservation.hold(ORDER_ID, product.getId(), 1, null);
            when(reservations.lockByOrderId(ORDER_ID)).thenReturn(List.of(hold));
            stubCatalogue(product);
            stubLockedStock(stock);

            service.release(ORDER_ID, "   ");

            ArgumentCaptor<StockReleasedEvent> event = ArgumentCaptor.forClass(StockReleasedEvent.class);
            verify(outbox).append(anyString(), anyString(), anyString(), anyString(), anyLong(), event.capture());
            assertThat(event.getValue().reason()).isEqualTo(StockReleasedEvent.REASON_UNSPECIFIED);
        }
    }

    // ------------------------------------------------------------------ read

    @Test
    void readingAnUnknownOrderIsNotFound() {
        when(reservations.findByOrderIdOrderByProductIdAsc(ORDER_ID)).thenReturn(List.of());

        assertThatThrownBy(() -> service.get(ORDER_ID))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CatalogErrorCode.RESERVATION_NOT_FOUND));
    }

    @Test
    void readingAStoredReservationNeedsNoLock() {
        Product product = product("TECH-1", 100_000L, Currency.KZT);
        StockReservation hold = StockReservation.hold(ORDER_ID, product.getId(), 4, null);
        when(reservations.findByOrderIdOrderByProductIdAsc(ORDER_ID)).thenReturn(List.of(hold));
        stubCatalogue(product);

        ReservationResponse response = service.get(ORDER_ID);

        assertThat(response.items()).singleElement()
                .satisfies(line -> assertThat(line.quantity()).isEqualTo(4));
        assertThat(response.subtotalMinor()).isEqualTo(400_000L);
        verify(reservations, never()).lockByOrderId(anyString());
    }
}
