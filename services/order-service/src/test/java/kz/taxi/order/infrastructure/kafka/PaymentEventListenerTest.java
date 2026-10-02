package kz.taxi.order.infrastructure.kafka;

import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import kz.taxi.common.kafka.consumer.IdempotentEventHandler;
import kz.taxi.common.kafka.consumer.InMemoryProcessedEventStore;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.application.CartApplicationService;
import kz.taxi.order.application.CheckoutSagaService;
import kz.taxi.order.application.OrderLifecycleService;
import kz.taxi.order.application.OrderQueryService;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.PaymentClient;
import kz.taxi.order.infrastructure.config.OrderProperties;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The Kafka listener, wired with the platform's real codec, de-duplication store and
 * a real saga; only the repositories and the downstream clients are mocks.
 *
 * <p>That is the interesting seam: the consumer's contract (decode, claim, restore
 * the trace, hand over the outcome) and the saga's no-op rule meet here, so this is
 * where they are tested together.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PaymentEventListenerTest {

    private static final String USER_ID = OrderFixtures.USER_ID;
    private static final String CORRELATION_ID = "corr-from-the-checkout";
    private static final long TOTAL = 10_000L;

    private final EventEnvelopeCodec codec = new EventEnvelopeCodec(
            JsonMapper.builder().addModule(new JavaTimeModule()).build());
    private final OrderProperties properties = new OrderProperties(0L, Duration.ofMinutes(5), 50);

    @Mock
    private IdempotencyGuard idempotencyGuard;
    @Mock
    private OrderLifecycleService lifecycle;
    @Mock
    private OrderQueryService orderQuery;
    @Mock
    private CartApplicationService cartService;
    @Mock
    private CatalogClient catalogClient;
    @Mock
    private PaymentClient paymentClient;

    private PaymentEventListener listener;
    private CustomerOrder order;

    @BeforeEach
    void setUp() {
        CheckoutSagaService saga = new CheckoutSagaService(idempotencyGuard, lifecycle, orderQuery, cartService,
                catalogClient, paymentClient, properties,
                JsonMapper.builder().addModule(new JavaTimeModule()).build());
        listener = new PaymentEventListener(
                new IdempotentEventHandler(codec, new InMemoryProcessedEventStore(Duration.ofDays(1))), saga);

        order = OrderFixtures.pendingOrder(USER_ID, TOTAL);
        when(lifecycle.findOrder(order.getId())).thenReturn(Optional.of(order));
        when(orderQuery.loadOrderResponse(order.getId()))
                .thenReturn(OrderFixtures.response(order.getId(), "PAID"));
    }

    @Test
    @DisplayName("payment.completed ends a waiting order: PAID and the stock committed")
    void completedEventFinalizesTheOrder() {
        order.markPaymentRequested();

        listener.onPaymentEvent(record(KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED"));

        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT));
        verify(catalogClient).commit(order.getId());
    }

    @Test
    @DisplayName("payment.failed releases the stock and cancels the order")
    void failedEventCancelsTheOrder() {
        order.markPaymentRequested();

        listener.onPaymentEvent(record(KafkaTopics.Events.PAYMENT_FAILED, "FAILED"));

        verify(catalogClient).release(eq(order.getId()), contains("payment was declined"));
        verify(lifecycle).markCancelled(eq(order.getId()), anyString(),
                eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT), eq(true));
    }

    @Test
    @DisplayName("a redelivered record is dropped by the dedup store before the saga sees it")
    void deduplicatesRedelivery() {
        order.markPaymentRequested();
        ConsumerRecord<String, String> record = record(KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED");

        listener.onPaymentEvent(record);
        listener.onPaymentEvent(record);

        verify(lifecycle, times(1)).markPaid(eq(order.getId()), any(), anyString());
    }

    @Test
    @DisplayName("a duplicate payment.completed for an order that is already PAID is a no-op")
    void duplicateEventOnAPaidOrderChangesNothing() {
        // The synchronous path already settled the order; this event is the duplicate
        // that Kafka is allowed to deliver.
        order.markPaid(new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.COMPLETED, TOTAL, "KZT", null, null));

        listener.onPaymentEvent(record(KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED"));
        listener.onPaymentEvent(record(KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED"));

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
        verify(catalogClient, never()).release(anyString(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("an event that did not move money is ignored")
    void ignoresOtherPaymentEvents() {
        listener.onPaymentEvent(record(KafkaTopics.Events.PAYMENT_INITIATED, "PROCESSING"));

        verifyNoInteractions(lifecycle);
    }

    @Test
    @DisplayName("a payment.completed event settles only the merchant line it names")
    void completedEventSettlesOnlyItsMerchantLine() {
        // A split order: two sellers, one line each. The event is about the second one.
        String merchant2 = "merchant-2";
        CustomerOrder split = OrderFixtures.pendingOrder(USER_ID, 15_500L);
        when(lifecycle.findOrder(split.getId())).thenReturn(Optional.of(split));
        OrderPayment first = OrderFixtures.paymentLine(split.getId(), OrderFixtures.MERCHANT_ID, 10_500L);
        OrderPayment second = OrderFixtures.paymentLine(split.getId(), merchant2, 5_000L);
        when(lifecycle.paymentsOf(split.getId())).thenReturn(List.of(first, second));
        split.markPaymentRequested();

        listener.onPaymentEvent(record(split.getId(), merchant2, 5_000L,
                KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED"));

        verify(lifecycle).markPaymentCompleted(eq(split.getId()), eq(merchant2), any());
        verify(lifecycle, never()).markPaymentCompleted(eq(split.getId()), eq(OrderFixtures.MERCHANT_ID), any());
        // One merchant of two is paid, so the order is not.
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
    }

    @Test
    @DisplayName("the correlation id of the original checkout travels with the event")
    void restoresTheCorrelationId() {
        order.markPaymentRequested();
        AtomicReference<String> seenCorrelationId = new AtomicReference<>();
        when(lifecycle.findOrder(order.getId())).thenAnswer(invocation -> {
            seenCorrelationId.set(CorrelationContext.get());
            return Optional.of(order);
        });

        listener.onPaymentEvent(record(KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED"));

        assertThat(seenCorrelationId.get()).isEqualTo(CORRELATION_ID);
    }

    @Test
    @DisplayName("the platform fee carried by the event is recorded on the merchant's line")
    void platformFeeFromTheEventIsRecorded() {
        long fee = 250L;
        order.markPaymentRequested();
        OrderPayment line = OrderFixtures.paymentLine(order.getId(), OrderFixtures.MERCHANT_ID, TOTAL);
        when(lifecycle.paymentsOf(order.getId())).thenReturn(List.of(line));
        // The real lifecycle service mutates the row; the mock does the same here.
        when(lifecycle.markPaymentCompleted(anyString(), anyString(), any())).thenAnswer(invocation -> {
            line.markCompleted(invocation.getArgument(2));
            return line;
        });

        listener.onPaymentEvent(record(order.getId(), OrderFixtures.MERCHANT_ID, TOTAL, fee,
                KafkaTopics.Events.PAYMENT_COMPLETED, "COMPLETED"));

        ArgumentCaptor<PaymentOutcome> applied = ArgumentCaptor.forClass(PaymentOutcome.class);
        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(OrderFixtures.MERCHANT_ID),
                applied.capture());
        assertThat(applied.getValue().amountMinor()).isEqualTo(TOTAL);
        assertThat(applied.getValue().feeMinor()).isEqualTo(fee);
        assertThat(applied.getValue().totalMinor()).isEqualTo(TOTAL + fee);
        // The single merchant of this order was the last one owed, so the order is PAID.
        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT));
    }

    // ------------------------------------------------------------------ helpers

    /** A record published by the payment service, headers and all. */
    private ConsumerRecord<String, String> record(String eventType, String status) {
        return record(order.getId(), OrderFixtures.MERCHANT_ID, TOTAL, eventType, status);
    }

    /**
     * The same, for one merchant's payment of an order: the id, the merchant and the
     * amount the payment service would report for that line.
     */
    private ConsumerRecord<String, String> record(String orderId, String merchantId, long amountMinor,
                                                  String eventType, String status) {
        return record(orderId, merchantId, amountMinor, 0L, eventType, status);
    }

    /** The same, with the platform fee the payment service charged on top of the amount. */
    private ConsumerRecord<String, String> record(String orderId, String merchantId, long amountMinor,
                                                  long feeMinor, String eventType, String status) {
        PaymentEventPayload payload = new PaymentEventPayload("payment-1", "PAY-1", "MERCHANT", status,
                USER_ID, amountMinor, feeMinor, amountMinor + feeMinor, "KZT", "account-1", "merchant-account",
                merchantId, orderId, null, null, Instant.now(), Instant.now());
        EventEnvelope<PaymentEventPayload> envelope = new EventEnvelope<>(Ulid.nextId(), eventType, "Payment",
                "payment-1", 1L, Instant.now(), CORRELATION_ID, null, payload);
        String json = codec.encode(envelope);

        ConsumerRecord<String, String> record = new ConsumerRecord<>(KafkaTopics.PAYMENT_EVENTS, 0, 0L,
                orderId, json);
        codec.headers(envelope).forEach((name, value) ->
                record.headers().add(name, value.getBytes(StandardCharsets.UTF_8)));
        return record;
    }
}
