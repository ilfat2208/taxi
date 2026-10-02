package kz.taxi.catalog.infrastructure.scheduler;

import kz.taxi.catalog.application.StockReservationService;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ReservationStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.domain.StockReservation;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.StockReservationRepository;
import kz.taxi.catalog.infrastructure.config.CatalogProperties;
import kz.taxi.catalog.infrastructure.events.StockReleasedEvent;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Expiry of overdue reservations.
 *
 * <p>The job is a scheduler shell, so the interesting assertions are made against
 * the use case it calls directly: which counters move, which statuses are written
 * and what the order service is told. Keeping the job dumb means the behaviour is
 * callable from a test and from an operator's script, with no scheduler involved.
 */
class ReservationExpiryJobTest {

    private static final String ORDER_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1T";
    private static final String OTHER_ORDER_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1U";

    private ProductRepository products;
    private StockRepository stocks;
    private StockReservationRepository reservations;
    private OutboxWriter outbox;
    private StockReservationService service;
    private ReservationExpiryJob job;

    @BeforeEach
    void setUp() {
        products = mock(ProductRepository.class);
        stocks = mock(StockRepository.class);
        reservations = mock(StockReservationRepository.class);
        outbox = mock(OutboxWriter.class);
        service = new StockReservationService(products, stocks, reservations, outbox,
                new CatalogProperties(Duration.ofMinutes(30)));
        job = new ReservationExpiryJob(service);
    }

    private static Product product(String sku) {
        return Product.publish("M-1", sku, "Товар " + sku, null, "Электроника", "Brand",
                Currency.KZT, 100_000L, null);
    }

    @Test
    @DisplayName("an overdue hold gives its stock back and the reservation is expired")
    void expiresOverdueReservationsAndReturnsTheirStock() {
        Product product = product("TECH-1");
        Stock stock = Stock.withOnHand(product.getId(), 5);
        stock.reserve(2);
        StockReservation overdue = StockReservation.hold(ORDER_ID, product.getId(), 2,
                Instant.now().minus(Duration.ofMinutes(1)));
        when(reservations.lockOverdue(eq(ReservationStatus.ACTIVE), any(Instant.class)))
                .thenReturn(List.of(overdue));
        when(products.findAllById(anyList())).thenReturn(List.of(product));
        when(stocks.lockAllByProductIdIn(anyList())).thenReturn(List.of(stock));

        int expired = service.expireOverdue();

        assertThat(expired).isEqualTo(1);
        assertThat(stock.getReserved()).isZero();
        assertThat(stock.getOnHand()).isEqualTo(5);
        assertThat(stock.available()).isEqualTo(5);
        assertThat(overdue.getStatus()).isEqualTo(ReservationStatus.EXPIRED);
        assertThat(overdue.isActive()).isFalse();

        ArgumentCaptor<StockReleasedEvent> event = ArgumentCaptor.forClass(StockReleasedEvent.class);
        verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.STOCK_RELEASED),
                eq("StockReservation"), eq(ORDER_ID), anyLong(), event.capture());
        assertThat(event.getValue().reason()).isEqualTo(StockReleasedEvent.REASON_EXPIRED);
        assertThat(event.getValue().items()).singleElement()
                .satisfies(line -> assertThat(line.quantity()).isEqualTo(2));
    }

    @Test
    @DisplayName("the scheduled job delegates to the use case and swallows nothing")
    void theScheduledEntryPointCallsTheUseCase() {
        StockReservationService mocked = mock(StockReservationService.class);
        when(mocked.expireOverdue()).thenReturn(3);

        new ReservationExpiryJob(mocked).expireOverdueReservations();

        verify(mocked).expireOverdue();
    }

    @Test
    @DisplayName("a reservation that is still within its TTL is not touched")
    void doesNothingWhenNoHoldIsOverdue() {
        when(reservations.lockOverdue(eq(ReservationStatus.ACTIVE), any(Instant.class)))
                .thenReturn(List.of());

        job.expireOverdueReservations();

        verifyNoInteractions(stocks);
        verifyNoInteractions(outbox);
    }

    @Test
    @DisplayName("all lines of one order are released, with one event for the checkout")
    void expiresEveryLineOfAnOrderWithASingleEvent() {
        Product first = product("TECH-1");
        Product second = product("TECH-2");
        Stock firstStock = Stock.withOnHand(first.getId(), 3);
        Stock secondStock = Stock.withOnHand(second.getId(), 3);
        firstStock.reserve(1);
        secondStock.reserve(1);
        StockReservation firstHold = StockReservation.hold(ORDER_ID, first.getId(), 1, null);
        StockReservation secondHold = StockReservation.hold(ORDER_ID, second.getId(), 1, null);
        when(reservations.lockOverdue(eq(ReservationStatus.ACTIVE), any(Instant.class)))
                .thenReturn(List.of(firstHold, secondHold));
        when(products.findAllById(anyList())).thenReturn(List.of(first, second));
        when(stocks.lockAllByProductIdIn(anyList())).thenReturn(List.of(firstStock, secondStock));

        int expired = service.expireOverdue();

        assertThat(expired).isEqualTo(2);
        assertThat(firstStock.getReserved()).isZero();
        assertThat(secondStock.getReserved()).isZero();
        assertThat(firstHold.getStatus()).isEqualTo(ReservationStatus.EXPIRED);
        assertThat(secondHold.getStatus()).isEqualTo(ReservationStatus.EXPIRED);
        verify(outbox).append(eq(KafkaTopics.CATALOG_EVENTS), eq(KafkaTopics.Events.STOCK_RELEASED),
                eq("StockReservation"), eq(ORDER_ID), anyLong(), any(StockReleasedEvent.class));
    }

    @Test
    @DisplayName("two orders expire independently, each with its own event")
    void expiresOverdueHoldsOfSeveralOrders() {
        Product product = product("TECH-1");
        Stock stock = Stock.withOnHand(product.getId(), 4);
        stock.reserve(2);
        StockReservation first = StockReservation.hold(ORDER_ID, product.getId(), 1, null);
        StockReservation second = StockReservation.hold(OTHER_ORDER_ID, product.getId(), 1, null);
        when(reservations.lockOverdue(eq(ReservationStatus.ACTIVE), any(Instant.class)))
                .thenReturn(List.of(first, second));
        when(products.findAllById(anyList())).thenReturn(List.of(product));
        when(stocks.lockAllByProductIdIn(anyList())).thenReturn(List.of(stock));

        assertThat(service.expireOverdue()).isEqualTo(2);

        assertThat(stock.getReserved()).isZero();
        verify(outbox).append(any(), any(), any(), eq(ORDER_ID), anyLong(), any());
        verify(outbox).append(any(), any(), any(), eq(OTHER_ORDER_ID), anyLong(), any());
        verify(reservations, never()).saveAll(anyList());
    }
}
