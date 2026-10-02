package kz.taxi.order.integration;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxMessage;
import kz.taxi.common.kafka.outbox.OutboxRepository;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.CartDtos;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.application.CartApplicationService;
import kz.taxi.order.application.CheckoutSagaService;
import kz.taxi.order.domain.CartStatus;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderPaymentStatus;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
import kz.taxi.order.domain.SagaState;
import kz.taxi.order.infrastructure.CartRepository;
import kz.taxi.order.infrastructure.CustomerOrderRepository;
import kz.taxi.order.infrastructure.OrderItemRepository;
import kz.taxi.order.infrastructure.OrderPaymentRepository;
import kz.taxi.order.infrastructure.OrderStatusHistoryRepository;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.CatalogDtos;
import kz.taxi.order.infrastructure.client.PaymentClient;
import kz.taxi.order.support.ItInfrastructure;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The checkout saga against a real PostgreSQL 16: Flyway migrations, Hibernate's
 * {@code ddl-auto: validate} against the frozen schema, and the persisted state
 * machine — order rows, status history and outbox rows, all in the same database the
 * service would use.
 *
 * <p><b>Stubbed:</b> only {@link CatalogClient} and {@link PaymentClient}, replaced by
 * Mockito beans in {@link StubbedDownstreamServices}. Their contract with this
 * service is HTTP, and standing up a real catalog and a real payment service would
 * test those services rather than this saga. Everything else is real: the datasource,
 * Flyway, the entities, the repositories, the transactional outbox, the idempotency
 * guard and the saga itself.
 *
 * <p>Redis and Kafka are not part of the test: the idempotency and dedup stores fall
 * back to their in-memory implementations, the outbox relay is disabled (the rows it
 * would publish are asserted directly) and the listener container does not start. The
 * recovery job is invoked explicitly instead of on its timer.
 *
 * <p>The database is a {@code postgres:16-alpine} container started by Testcontainers —
 * unless {@code IT_DATABASE_URL} is set, in which case the test runs against that
 * database (a test one, never the demo one: Flyway migrates it) and starts no container
 * at all. {@link ItInfrastructure} explains the choice; {@code scripts/it-local.ps1}
 * makes it locally. {@link #cleanDatabase()} empties the tables before every scenario,
 * so a long-lived external database behaves exactly like the fresh container the suite
 * was written for — the recovery test, for instance, insists on finding exactly one
 * stuck order.
 *
 * <p>Runs only with {@code mvn verify -Pintegration} (failsafe, {@code *IT}); without a
 * usable Docker and without {@code IT_DATABASE_URL} the class is reported as skipped.
 */
@EnabledIf(ItInfrastructure.AVAILABLE_METHOD)
@SpringBootTest(properties = {
        "taxi.idempotency.store=memory",
        "taxi.kafka.dedup.store=memory",
        "taxi.outbox.enabled=false",
        "spring.kafka.listener.auto-startup=false",
        "spring.kafka.admin.properties.default.api.timeout.ms=200",
        "spring.kafka.admin.properties.request.timeout.ms=200",
        "spring.kafka.admin.properties.max.block.ms=200",
        "taxi.orders.recovery-initial-delay-ms=3600000",
        "taxi.orders.recovery-interval-ms=3600000",
        // Short, so the recovery test reaches a "stuck" order without waiting minutes.
        "taxi.orders.saga-timeout=10ms"
})
class CheckoutSagaIT {

    /**
     * Started by {@link ItInfrastructure#start} <em>unless</em> {@code IT_DATABASE_URL}
     * points the test at an already-running database; never referenced before the
     * {@code @EnabledIf} condition above has passed.
     */
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16-alpine"));

    private static final ItInfrastructure INFRASTRUCTURE = ItInfrastructure.start(POSTGRES);

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        INFRASTRUCTURE.register(registry);
    }

    /**
     * Stand-ins for the two downstream services.
     *
     * <p>{@code @Primary} rather than replacing the auto-configured beans: which of two
     * user configurations is processed first is an implementation detail of the context
     * loader, and a test that depends on it breaks for reasons that have nothing to do
     * with the saga.
     */
    @TestConfiguration(proxyBeanMethods = false)
    static class StubbedDownstreamServices {

        @Bean
        @Primary
        CatalogClient stubbedCatalogClient() {
            return Mockito.mock(CatalogClient.class);
        }

        @Bean
        @Primary
        PaymentClient stubbedPaymentClient() {
            return Mockito.mock(PaymentClient.class);
        }
    }

    @Autowired
    private CatalogClient stubbedCatalogClient;
    @Autowired
    private PaymentClient stubbedPaymentClient;

    @Autowired
    private CheckoutSagaService checkoutSaga;
    @Autowired
    private CartApplicationService cartService;
    @Autowired
    private CustomerOrderRepository orderRepository;
    @Autowired
    private OrderItemRepository orderItemRepository;
    @Autowired
    private OrderStatusHistoryRepository historyRepository;
    @Autowired
    private CartRepository cartRepository;
    @Autowired
    private OrderPaymentRepository orderPaymentRepository;
    @Autowired
    private OutboxRepository outboxRepository;
    @Autowired
    private JdbcTemplate jdbc;

    private String userId;

    @BeforeEach
    void setUp() {
        userId = "user-" + UUID.randomUUID();
        cleanDatabase();
        // The two doubles are beans, so they live exactly as long as the context — that is,
        // across scenarios. Without this reset both their stubs and their recorded calls
        // survive into the next test: the thenThrow of the timeout scenario makes the next
        // checkout fail with "payment did not answer", and a never() verification sees the
        // calls of a different test. The class is order-dependent without this line, and
        // order was the only thing that ever made it look green.
        Mockito.reset(stubbedCatalogClient, stubbedPaymentClient);
        when(stubbedCatalogClient.getProduct(anyString()))
                .thenAnswer(invocation -> product(invocation.getArgument(0)));
        when(stubbedCatalogClient.imageUrlOf(anyString())).thenReturn("https://cdn.test/image.png");
        when(stubbedCatalogClient.reserve(anyString(), any()))
                .thenAnswer(invocation -> reservation(invocation.getArgument(0), 25_000L));
    }

    /**
     * Empties the service's tables before every scenario.
     *
     * <p>A container is new for every run, an external database is not, and this class
     * does not only read: {@code recoverStuckCheckouts()} is asserted to return exactly
     * one order, so an order left behind by an earlier run would break a test that has
     * nothing to do with it. {@code CASCADE} is what makes the list short — the items,
     * the history and the payment lines of an order are reachable only through it, and
     * naming them here would be a second, silently rotting copy of the schema.
     */
    private void cleanDatabase() {
        jdbc.execute("truncate table orders.support_audit_record, orders.outbox_message,"
                + " orders.customer_order, orders.cart restart identity cascade");
    }

    // ------------------------------------------------------------------ happy path

    @Test
    @DisplayName("the migrations apply and a checkout settles: PAID, stock committed, cart consumed, events in the outbox")
    void checkoutSettlesTheOrder() {
        String cartId = fillCart();
        givenPaymentOutcome(payment(PaymentStatus.COMPLETED, 25_000L));

        CheckoutSagaService.CheckoutResult result = checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId);

        assertThat(result.awaitingPaymentOutcome()).isFalse();
        CustomerOrder order = orderRepository.findById(result.order().orderId()).orElseThrow();

        assertThat(order.getStatus()).isEqualTo(OrderStatus.PAID);
        assertThat(order.getSagaState()).isEqualTo(SagaState.COMPLETED);
        assertThat(order.getPaidAt()).isNotNull();
        assertThat(order.getPaymentId()).isEqualTo("payment-1");
        assertThat(order.getPaymentStatus()).isEqualTo(PaymentStatus.COMPLETED.name());
        // total = subtotal + delivery fee, exactly as the CHECK constraint requires.
        assertThat(order.getTotalMinor()).isEqualTo(order.getSubtotalMinor() + order.getDeliveryFeeMinor());
        assertThat(order.getSubtotalMinor()).isEqualTo(25_000L);
        assertThat(order.getCurrency()).isEqualTo(Currency.KZT);
        assertThat(order.getOrderNumber()).startsWith("ORD-");

        // Lines are frozen copies of the cart, with the CHECK-constrained line total.
        assertThat(orderItemRepository.findByOrderIdOrderByIdAsc(order.getId()))
                .hasSize(2)
                .allSatisfy(item -> assertThat(item.getLineTotalMinor())
                        .isEqualTo(item.getUnitPriceMinor() * item.getQuantity()));

        // The cart was consumed, and kept as history rather than deleted.
        assertThat(cartRepository.findById(cartId).orElseThrow().getStatus()).isEqualTo(CartStatus.CHECKED_OUT);

        // The trail tells the story of the saga.
        assertThat(historyRepository.findByOrderIdOrderByCreatedAtAsc(order.getId()))
                .extracting(history -> history.getToStatus().name())
                .containsExactly(OrderStatus.PENDING_PAYMENT.name(), OrderStatus.PAID.name());

        // order.created and order.paid were committed together with the state changes.
        assertThat(eventsOf(order.getId()))
                .containsExactlyInAnyOrder(KafkaTopics.Events.ORDER_CREATED, KafkaTopics.Events.ORDER_PAID);
        assertThat(outboxRepository.findByAggregateIdOrderByCreatedAtAsc(order.getId()))
                .allSatisfy(message -> {
                    assertThat(message.getTopic()).isEqualTo(KafkaTopics.ORDER_EVENTS);
                    assertThat(message.getPayload()).contains(order.getOrderNumber());
                    assertThat(message.getPartitionKey()).isEqualTo(order.getId());
                });

        verify(stubbedCatalogClient).commit(order.getId());
        verify(stubbedPaymentClient).createMerchantPayment(any(),
                eq("ORD-" + order.getId() + "-PAY-" + OrderFixtures.MERCHANT_ID));

        // The per-merchant payment lines were persisted before the charge, and the one
        // seller of this order carries the whole total (delivery fee included).
        assertThat(paymentRowsOf(order.getId())).singleElement().satisfies(line -> {
            assertThat(line.getMerchantId()).isEqualTo(OrderFixtures.MERCHANT_ID);
            assertThat(line.getStatus()).isEqualTo(OrderPaymentStatus.COMPLETED);
            assertThat(line.getAmountMinor()).isEqualTo(order.getTotalMinor());
            assertThat(line.getTotalMinor()).isEqualTo(line.getAmountMinor() + line.getFeeMinor());
            assertThat(line.currencyCode()).isEqualTo("KZT");
            assertThat(line.getPaymentId()).isEqualTo("payment-1");
        });
    }

    @Test
    @DisplayName("the same Idempotency-Key never creates a second order")
    void repeatedCheckoutIsIdempotent() {
        fillCart();
        givenPaymentOutcome(payment(PaymentStatus.COMPLETED, 25_000L));
        String key = "key-" + userId;

        CheckoutSagaService.CheckoutResult first = checkoutSaga.checkout(checkoutRequest(), key, userId);
        CheckoutSagaService.CheckoutResult second = checkoutSaga.checkout(checkoutRequest(), key, userId);

        assertThat(second.order().orderId()).isEqualTo(first.order().orderId());
        assertThat(ordersOf(userId)).hasSize(1);
        verify(stubbedPaymentClient, times(1)).createMerchantPayment(any(), anyString());
    }

    // ------------------------------------------------------------------ compensation

    @Test
    @DisplayName("stock refused: CANCELLED with a reason, the goods released, the payment never attempted")
    void stockRefusalCompensates() {
        fillCart();
        when(stubbedCatalogClient.reserve(anyString(), any()))
                .thenThrow(DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE, "only 1 are left"));

        assertThatThrownBy(() -> checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);

        CustomerOrder order = onlyOrderOf(userId);
        assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(order.getFailureReason()).startsWith("PRODUCT_UNAVAILABLE: ");
        assertThat(order.getSagaState()).isEqualTo(SagaState.CANCELLED);
        assertThat(order.getPaidAt()).isNull();
        assertThat(eventsOf(order.getId()))
                .containsExactlyInAnyOrder(KafkaTopics.Events.ORDER_CREATED, KafkaTopics.Events.ORDER_CANCELLED);
        verify(stubbedPaymentClient, never()).createMerchantPayment(any(), anyString());
    }

    @Test
    @DisplayName("payment declined: the reservation is released, the order is CANCELLED, order.cancelled is published")
    void declinedPaymentCompensates() {
        fillCart();
        givenPaymentOutcome(payment(PaymentStatus.FAILED, 0L));

        assertThatThrownBy(() -> checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_DECLINED);

        CustomerOrder order = onlyOrderOf(userId);
        assertThat(order.getStatus()).isEqualTo(OrderStatus.CANCELLED);
        assertThat(order.getFailureReason()).startsWith("PAYMENT_DECLINED: ");
        assertThat(order.getPaymentStatus()).isEqualTo(PaymentStatus.FAILED.name());
        // eq(...) around the id, not the raw value: as soon as one argument of a
        // verification is a matcher, every argument has to be one (Mockito refuses the
        // mix with InvalidUseOfMatchersException, which is what this line used to do).
        verify(stubbedCatalogClient).release(eq(order.getId()), anyString());
        assertThat(eventsOf(order.getId()))
                .containsExactlyInAnyOrder(KafkaTopics.Events.ORDER_CREATED, KafkaTopics.Events.ORDER_CANCELLED);
    }

    @Test
    @DisplayName("a payment timeout leaves the order PENDING_PAYMENT, and the recovery job resolves it later")
    void paymentTimeoutIsRecovered() throws InterruptedException {
        fillCart();
        when(stubbedPaymentClient.createMerchantPayment(any(), anyString()))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "payment did not answer"));

        assertThatThrownBy(() -> checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.DOWNSTREAM_UNAVAILABLE);

        CustomerOrder stuck = onlyOrderOf(userId);
        // The order survived: it is waiting, not lost, and nothing was released.
        assertThat(stuck.getStatus()).isEqualTo(OrderStatus.PENDING_PAYMENT);
        assertThat(stuck.getSagaState()).isEqualTo(SagaState.PAYMENT_UNKNOWN);
        assertThat(stuck.getFailureReason()).contains("payment did not answer");
        verify(stubbedCatalogClient, never()).release(anyString(), anyString());
        verify(stubbedCatalogClient, never()).commit(anyString());

        // Then the payment actually completed, and the recovery job finds out.
        Thread.sleep(50L);
        when(stubbedPaymentClient.findByOrderId(stuck.getId()))
                .thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, 25_000L)));

        assertThat(checkoutSaga.recoverStuckCheckouts()).isEqualTo(1);

        CustomerOrder recovered = orderRepository.findById(stuck.getId()).orElseThrow();
        assertThat(recovered.getStatus()).isEqualTo(OrderStatus.PAID);
        assertThat(recovered.getSagaState()).isEqualTo(SagaState.COMPLETED);
        assertThat(recovered.getPaidAt()).isNotNull();
        verify(stubbedCatalogClient).commit(stuck.getId());
        assertThat(eventsOf(stuck.getId()))
                .containsExactlyInAnyOrder(KafkaTopics.Events.ORDER_CREATED, KafkaTopics.Events.ORDER_PAID);
    }

    @Test
    @DisplayName("a duplicate payment.completed for an already PAID order changes nothing")
    void duplicateEventIsANoOp() {
        fillCart();
        givenPaymentOutcome(payment(PaymentStatus.COMPLETED, 25_000L));
        String orderId = checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId).order().orderId();
        int historyBefore = historyRepository.findByOrderIdOrderByCreatedAtAsc(orderId).size();

        checkoutSaga.reconcilePayment(orderId, payment(PaymentStatus.COMPLETED, 25_000L), "payment-event");

        assertThat(orderRepository.findById(orderId).orElseThrow().getStatus()).isEqualTo(OrderStatus.PAID);
        assertThat(historyRepository.findByOrderIdOrderByCreatedAtAsc(orderId)).hasSize(historyBefore);
        assertThat(eventsOf(orderId))
                .containsExactlyInAnyOrder(KafkaTopics.Events.ORDER_CREATED, KafkaTopics.Events.ORDER_PAID);
    }

    // ------------------------------------------------------------------ cancellation

    @Test
    @DisplayName("cancelling a waiting order releases the stock, and cancelling twice returns the same state")
    void cancellingAWaitingOrderReleasesTheStock() {
        fillCart();
        givenPaymentOutcome(payment(PaymentStatus.FAILED, 0L));
        assertThatThrownBy(() -> checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId))
                .isInstanceOf(DomainException.class);
        CustomerOrder cancelled = onlyOrderOf(userId);
        AuthenticatedUser owner = owner(cancelled.getUserId());

        OrderDtos.OrderResponse first = checkoutSaga.cancel(cancelled.getId(), "changed my mind", owner,
                Optional.of("cancel-" + userId));
        OrderDtos.OrderResponse second = checkoutSaga.cancel(cancelled.getId(), null, owner, Optional.empty());

        assertThat(first.status()).isEqualTo(OrderStatus.CANCELLED.name());
        assertThat(second.status()).isEqualTo(OrderStatus.CANCELLED.name());
        assertThat(eventsOf(cancelled.getId())).contains(KafkaTopics.Events.ORDER_CANCELLED);
        // The refund of a cancelled, declined order is never attempted: nothing was charged.
        verify(stubbedPaymentClient, never()).refund(anyString(), anyString(), anyString());
    }

    @Test
    @DisplayName("an empty cart cannot be checked out, and no order row is created")
    void emptyCartCannotBeCheckedOut() {
        cartService.getCart(userId);

        assertThatThrownBy(() -> checkoutSaga.checkout(checkoutRequest(), "key-" + userId, userId))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CART_EMPTY);

        assertThat(ordersOf(userId)).isEmpty();
    }

    // ------------------------------------------------------------------ helpers

    /** Fills a cart through the real cart service, so the snapshot path is exercised too. */
    private String fillCart() {
        CartDtos.CartResponse cart = cartService.addItem(userId, "product-1", 1);
        cart = cartService.addItem(userId, "product-2", 2);
        assertThat(cart.subtotalMinor()).isEqualTo(25_000L);
        return cart.cartId();
    }

    private OrderDtos.CheckoutRequest checkoutRequest() {
        return new OrderDtos.CheckoutRequest("Almaty, Abay 1", "+77000000000", "leave at the door", "account-1");
    }

    private static AuthenticatedUser owner(String userId) {
        return new AuthenticatedUser(userId, "+77000000000", "Customer", Set.of("CUSTOMER"));
    }

    private List<CustomerOrder> ordersOf(String userId) {
        return orderRepository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, 10)).getContent();
    }

    private CustomerOrder onlyOrderOf(String userId) {
        List<CustomerOrder> orders = ordersOf(userId);
        assertThat(orders).hasSize(1);
        return orders.get(0);
    }

    private List<String> eventsOf(String orderId) {
        return outboxRepository.findByAggregateIdOrderByCreatedAtAsc(orderId).stream()
                .map(OutboxMessage::getEventType)
                .toList();
    }

    /** The per-merchant payment lines of an order, in the order the saga charged them. */
    private List<OrderPayment> paymentRowsOf(String orderId) {
        return orderPaymentRepository.findByOrderIdOrderByMerchantIdAsc(orderId);
    }

    private void givenPaymentOutcome(PaymentOutcome outcome) {
        when(stubbedPaymentClient.createMerchantPayment(any(), anyString())).thenReturn(outcome);
    }

    private static PaymentOutcome payment(PaymentStatus status, long amountMinor) {
        return new PaymentOutcome("payment-1", "PAY-000001", status, amountMinor, "KZT",
                status.isFailed() ? "INSUFFICIENT_FUNDS" : null,
                status.isFailed() ? "insufficient funds" : null);
    }

    private static CatalogDtos.InternalProduct product(String productId) {
        long priceMinor = "product-1".equals(productId) ? 10_000L : 7_500L;
        return new CatalogDtos.InternalProduct(productId, OrderFixtures.MERCHANT_ID, "Title " + productId,
                priceMinor, "KZT", "ACTIVE", 10);
    }

    /** The stub answers with the amount the order will actually total. */
    private static CatalogDtos.Reservation reservation(String orderId, long subtotalMinor) {
        return new CatalogDtos.Reservation(orderId, "ACTIVE", "KZT", subtotalMinor,
                Instant.now().plus(Duration.ofMinutes(30)), List.of());
    }
}
