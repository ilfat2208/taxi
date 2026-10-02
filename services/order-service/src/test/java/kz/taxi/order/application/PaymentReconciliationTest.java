package kz.taxi.order.application;

import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
import kz.taxi.order.domain.SagaState;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.PaymentClient;
import kz.taxi.order.infrastructure.config.OrderProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The two paths that resolve an order nobody finished: the payment event stream and
 * the scheduled recovery job.
 *
 * <p>The tests that matter most here are the negative ones. A duplicate event must
 * change nothing, a payment for the wrong amount must change nothing, and an
 * unreachable payment service must change nothing — because in each of those cases
 * the alternative is an order that says PAID (or CANCELLED) without the facts to
 * back it up.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PaymentReconciliationTest {

    private static final String USER_ID = OrderFixtures.USER_ID;
    private static final String MERCHANT_1 = OrderFixtures.MERCHANT_ID;
    private static final String MERCHANT_2 = "merchant-2";
    private static final String MERCHANT_1_PAYMENT = "payment-1";
    private static final String MERCHANT_2_PAYMENT = "payment-2";
    private static final long TOTAL = 10_000L;
    private static final long DELIVERY_FEE = 500L;

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

    private final OrderProperties properties = new OrderProperties(0L, Duration.ofMinutes(5), 50);

    private CheckoutSagaService saga;
    private CustomerOrder order;

    @BeforeEach
    void setUp() {
        saga = new CheckoutSagaService(idempotencyGuard, lifecycle, orderQuery, cartService, catalogClient,
                paymentClient, properties, JsonMapper.builder().addModule(new JavaTimeModule()).build());
        order = OrderFixtures.pendingOrder(USER_ID, TOTAL);
        when(lifecycle.findOrder(order.getId())).thenReturn(Optional.of(order));
        when(lifecycle.findOrderByPaymentId("payment-1")).thenReturn(Optional.of(order));
        when(orderQuery.loadOrderResponse(order.getId()))
                .thenReturn(OrderFixtures.response(order.getId(), "PENDING_PAYMENT"));
        when(lifecycle.findStuckPending(any(), anyInt())).thenReturn(List.of(order));
        when(lifecycle.findInSagaStates(any(), any(), anyInt())).thenReturn(List.of());
        // An order created before split payments: one payment for the whole total, no
        // per-merchant lines. The split tests below give it lines of its own.
        when(lifecycle.paymentsOf(anyString())).thenReturn(List.of());
    }

    // ------------------------------------------------------------------ payment events

    @Test
    @DisplayName("payment.completed finalizes an order that is still waiting for it")
    void completedEventFinalizesTheOrder() {
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), payment(PaymentStatus.COMPLETED, TOTAL),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT));
        verify(catalogClient).commit(order.getId());
        verify(lifecycle).markStockCommitted(order.getId());
    }

    @Test
    @DisplayName("a duplicate payment.completed for a PAID order is a no-op")
    void completedEventOnAPaidOrderChangesNothing() {
        order.markPaid(payment(PaymentStatus.COMPLETED, TOTAL));

        saga.reconcilePayment(order.getId(), payment(PaymentStatus.COMPLETED, TOTAL),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(catalogClient, never()).release(anyString(), anyString());
    }

    @Test
    @DisplayName("a late event does not resurrect a cancelled order")
    void completedEventOnACancelledOrderChangesNothing() {
        order.cancelByUser("cancelled by the customer", true);

        saga.reconcilePayment(order.getId(), payment(PaymentStatus.COMPLETED, TOTAL),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
    }

    @Test
    @DisplayName("payment.failed releases the stock and cancels the order")
    void failedEventCancelsTheOrder() {
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), payment(PaymentStatus.FAILED, TOTAL),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle).markPaymentDeclined(eq(order.getId()), any());
        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("PAYMENT_DECLINED"),
                eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT), eq(true));
    }

    @Test
    @DisplayName("a payment for the wrong amount never marks an order paid")
    void completedEventWithTheWrongAmountIsRefused() {
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), payment(PaymentStatus.COMPLETED, TOTAL - 1),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("an event without an amount is verified against the payment service before it is trusted")
    void completedEventWithoutAnAmountIsVerified() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, TOTAL)));

        // The event says "completed" but carries no amount and no currency: the
        // payment service is asked for the authoritative payment.
        saga.reconcilePayment(order.getId(),
                new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.COMPLETED, 0L, null, null, null),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(paymentClient).findByOrderId(order.getId());
        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT));
    }

    @Test
    @DisplayName("an event whose amount cannot be confirmed leaves the order to the recovery job")
    void completedEventWithoutAConfirmableAmountIsIgnored() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId()))
                .thenThrow(DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR, "payment service is down"));

        saga.reconcilePayment(order.getId(), new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.COMPLETED,
                0L, null, null, null), OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("an event for an order this service does not know is ignored, not retried forever")
    void eventForAnUnknownOrderIsIgnored() {
        when(lifecycle.findOrder("unknown-order")).thenReturn(Optional.empty());

        saga.reconcilePayment("unknown-order", payment(PaymentStatus.COMPLETED, TOTAL),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verifyNoInteractions(catalogClient);
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("an event that names no order is resolved through its payment id")
    void eventWithoutAnOrderIdIsResolvedByPaymentId() {
        order.markPaymentRequested();

        saga.reconcilePayment(null, payment(PaymentStatus.COMPLETED, TOTAL),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle).findOrderByPaymentId("payment-1");
        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT));
    }

    // ------------------------------------------------------------------ recovery job

    @Test
    @DisplayName("an order whose payment was never requested is cancelled and its stock released")
    void abandonedCheckoutIsCancelled() {
        int resolved = saga.recoverStuckCheckouts();

        assertThat(resolved).isEqualTo(1);
        verify(catalogClient).release(eq(order.getId()), contains("abandoned before the payment was requested"));
        verify(lifecycle).markCancelled(eq(order.getId()),
                contains("abandoned before the payment was requested"),
                eq(OrderStatusHistory.ACTOR_RECOVERY_JOB), eq(true));
        verifyNoInteractions(paymentClient);
    }

    @Test
    @DisplayName("an order whose reservation was held but never charged is cancelled too")
    void stuckAfterReservationIsCancelled() {
        order.markStockReserved();

        assertThat(saga.recoverStuckCheckouts()).isEqualTo(1);

        verify(catalogClient).release(eq(order.getId()), anyString());
    }

    @Test
    @DisplayName("a payment that completed after the timeout is applied to the order")
    void stuckOrderWithACompletedPaymentIsFinalized() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, TOTAL)));

        assertThat(saga.recoverStuckCheckouts()).isEqualTo(1);

        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_RECOVERY_JOB));
        verify(catalogClient).commit(order.getId());
    }

    @Test
    @DisplayName("a payment that failed after the timeout cancels the order")
    void stuckOrderWithAFailedPaymentIsCancelled() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.of(payment(PaymentStatus.FAILED, TOTAL)));

        assertThat(saga.recoverStuckCheckouts()).isEqualTo(1);

        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("PAYMENT_DECLINED"),
                eq(OrderStatusHistory.ACTOR_RECOVERY_JOB), eq(true));
    }

    @Test
    @DisplayName("an order the payment service has no payment for was never charged")
    void stuckOrderWithoutAPaymentIsCancelled() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.empty());

        assertThat(saga.recoverStuckCheckouts()).isEqualTo(1);

        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("no payment for this order"),
                eq(OrderStatusHistory.ACTOR_RECOVERY_JOB), eq(true));
    }

    @Test
    @DisplayName("the stored payment id is used when the order lookup fails")
    void fallsBackToTheStoredPaymentId() {
        order.markPaymentRequested();
        order.markPaymentDeclined(payment(PaymentStatus.FAILED, TOTAL),
                kz.taxi.order.domain.OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED, "declined"));
        when(paymentClient.findByOrderId(order.getId()))
                .thenThrow(DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR, "403 from the payment service"));
        when(paymentClient.findByPaymentId("payment-1"))
                .thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, TOTAL)));

        saga.recoverStuckCheckouts();

        verify(paymentClient).findByPaymentId("payment-1");
        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_RECOVERY_JOB));
    }

    @Test
    @DisplayName("an unreachable payment service leaves the order exactly as it is")
    void unreachablePaymentServiceChangesNothing() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId()))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "timeout"));

        assertThat(saga.recoverStuckCheckouts()).isZero();

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(catalogClient, never()).release(anyString(), anyString());
        assertThat(order.getStatus().name()).isEqualTo("PENDING_PAYMENT");
    }

    @Test
    @DisplayName("a payment for another amount is left for a human")
    void mismatchedPaymentIsLeftAlone() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId()))
                .thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, TOTAL + 500)));

        assertThat(saga.recoverStuckCheckouts()).isZero();

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("a stock release left owed by a cancelled order is retried")
    void retriesPendingCompensations() {
        CustomerOrder cancelled = OrderFixtures.pendingOrder(USER_ID, TOTAL);
        cancelled.cancelByUser("cancelled by the customer", false);
        when(lifecycle.findInSagaStates(eq(java.util.Set.of(SagaState.STOCK_RELEASE_PENDING)), any(), anyInt()))
                .thenReturn(List.of(cancelled));

        assertThat(saga.retryPendingCompensations()).isEqualTo(1);

        verify(catalogClient).release(eq(cancelled.getId()), anyString());
        verify(lifecycle).markStockReleased(cancelled.getId());
    }

    @Test
    @DisplayName("a stock commit left owed by a paid order is retried")
    void retriesPendingCommits() {
        CustomerOrder paid = OrderFixtures.pendingOrder(USER_ID, TOTAL);
        paid.markPaid(payment(PaymentStatus.COMPLETED, TOTAL));
        when(lifecycle.findInSagaStates(eq(java.util.Set.of(SagaState.STOCK_COMMIT_PENDING)), any(), anyInt()))
                .thenReturn(List.of(paid));

        assertThat(saga.retryPendingStockCommits()).isEqualTo(1);

        verify(catalogClient).commit(paid.getId());
        verify(lifecycle).markStockCommitted(paid.getId());
    }

    @Test
    @DisplayName("the recovery job only looks at orders older than the saga timeout")
    void onlyLooksAtOrdersOlderThanTheTimeout() {
        saga.recoverStuckCheckouts();

        org.mockito.ArgumentCaptor<Instant> threshold = org.mockito.ArgumentCaptor.forClass(Instant.class);
        verify(lifecycle).findStuckPending(threshold.capture(), eq(50));

        assertThat(threshold.getValue()).isBefore(Instant.now().minus(Duration.ofMinutes(4)));
    }

    // ------------------------------------------------------------------ split orders

    /**
     * An order charged per merchant: two sellers, one line each, and the delivery fee
     * on the larger of the two.
     */
    private List<OrderPayment> splitOrder() {
        order = OrderFixtures.pendingOrder(USER_ID, 15_000L, DELIVERY_FEE);
        when(lifecycle.findOrder(order.getId())).thenReturn(Optional.of(order));
        when(lifecycle.findStuckPending(any(), anyInt())).thenReturn(List.of(order));

        OrderPayment first = OrderFixtures.paymentLine(order.getId(), MERCHANT_1, 10_000L + DELIVERY_FEE);
        OrderPayment second = OrderFixtures.paymentLine(order.getId(), MERCHANT_2, 5_000L);
        List<OrderPayment> lines = List.of(first, second);
        when(lifecycle.paymentsOf(order.getId())).thenReturn(lines);
        // The real lifecycle service mutates the rows; the mock is made to do the same
        // so a second answer sees the progress the first one wrote down.
        when(lifecycle.markPaymentCompleted(anyString(), anyString(), any())).thenAnswer(invocation -> {
            String merchantId = invocation.getArgument(1);
            PaymentOutcome outcome = invocation.getArgument(2);
            lines.stream().filter(line -> line.getMerchantId().equals(merchantId))
                    .forEach(line -> line.markCompleted(outcome));
            return lines.get(0);
        });
        when(lifecycle.markPaymentRefunded(anyString(), anyString())).thenAnswer(invocation -> {
            String merchantId = invocation.getArgument(1);
            lines.stream().filter(line -> line.getMerchantId().equals(merchantId))
                    .forEach(OrderPayment::markRefunded);
            return lines.get(0);
        });
        return lines;
    }

    @Test
    @DisplayName("payment.completed settles only the merchant it names, not the order")
    void completedEventSettlesOnlyItsOwnLine() {
        splitOrder();
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), MERCHANT_1,
                payment(MERCHANT_1_PAYMENT, PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_1), any());
        verify(lifecycle, never()).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_2), any());
        // One merchant of two is paid: the order is not, and nothing is committed.
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("the order becomes PAID only when the last merchant is paid")
    void orderIsPaidOnlyWhenEveryMerchantIsPaid() {
        splitOrder();
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), MERCHANT_2,
                payment(MERCHANT_2_PAYMENT, PaymentStatus.COMPLETED, 5_000L),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());

        saga.reconcilePayment(order.getId(), MERCHANT_1,
                payment(MERCHANT_1_PAYMENT, PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT));
        verify(catalogClient).commit(order.getId());
        verify(lifecycle).markStockCommitted(order.getId());
    }

    @Test
    @DisplayName("an event that names a merchant whose payment id is unknown settles that line")
    void eventWithoutARecordedPaymentIdMatchesByMerchant() {
        splitOrder();
        order.markPaymentRequested();

        // The synchronous charge of merchant-2 timed out, so its line has no payment id:
        // the merchant in the event is the only fact that identifies the line.
        saga.reconcilePayment(order.getId(), MERCHANT_2,
                payment(MERCHANT_2_PAYMENT, PaymentStatus.COMPLETED, 5_000L),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_2), any());
        verify(lifecycle, never()).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_1), any());
    }

    @Test
    @DisplayName("an event that matches no line of a split order is ignored, never guessed onto one")
    void eventThatMatchesNoLineIsIgnored() {
        splitOrder();
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), "merchant-9",
                payment("payment-9", PaymentStatus.COMPLETED, 5_000L),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle, never()).markPaymentCompleted(anyString(), anyString(), any());
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("an event for the wrong amount is not applied to the merchant's line")
    void eventWithTheWrongAmountIsRefused() {
        splitOrder();
        order.markPaymentRequested();

        saga.reconcilePayment(order.getId(), MERCHANT_2,
                payment(MERCHANT_2_PAYMENT, PaymentStatus.COMPLETED, 4_999L),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(lifecycle, never()).markPaymentCompleted(anyString(), anyString(), any());
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("a failure for one merchant refunds the merchant already paid and cancels the order")
    void failedEventRefundsTheOtherMerchantAndCancels() {
        List<OrderPayment> lines = splitOrder();
        order.markPaymentRequested();
        lines.get(0).markCompleted(
                payment(MERCHANT_1_PAYMENT, PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE));

        saga.reconcilePayment(order.getId(), MERCHANT_2, payment(MERCHANT_2_PAYMENT, PaymentStatus.FAILED, 0L),
                OrderStatusHistory.ACTOR_PAYMENT_EVENT);

        verify(paymentClient).refund(eq(MERCHANT_1_PAYMENT), anyString(),
                eq("ORD-" + order.getId() + "-REFUND-" + MERCHANT_1));
        verify(lifecycle).markPaymentRefunded(order.getId(), MERCHANT_1);
        verify(lifecycle).markPaymentDeclined(eq(order.getId()), eq(MERCHANT_2), any());
        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("PAYMENT_DECLINED"),
                eq(OrderStatusHistory.ACTOR_PAYMENT_EVENT), eq(true));
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("a stuck split order whose every line is paid is finalized")
    void stuckSplitOrderWithEveryLinePaidIsFinalized() {
        List<OrderPayment> lines = splitOrder();
        order.markPaymentRequested();
        lines.get(0).markCompleted(
                payment(MERCHANT_1_PAYMENT, PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE));
        lines.get(1).markCompleted(payment(MERCHANT_2_PAYMENT, PaymentStatus.COMPLETED, 5_000L));

        assertThat(saga.recoverStuckCheckouts()).isEqualTo(1);

        verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_RECOVERY_JOB));
        verify(catalogClient).commit(order.getId());
    }

    @Test
    @DisplayName("a stuck split order with one refused merchant is refunded and cancelled")
    void stuckSplitOrderWithARefusedLineCompensates() {
        List<OrderPayment> lines = splitOrder();
        order.markPaymentRequested();
        lines.get(0).markCompleted(
                payment(MERCHANT_1_PAYMENT, PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE));
        lines.get(1).markFailed(payment(MERCHANT_2_PAYMENT, PaymentStatus.FAILED, 0L));

        assertThat(saga.recoverStuckCheckouts()).isEqualTo(1);

        verify(paymentClient).refund(eq(MERCHANT_1_PAYMENT), anyString(),
                eq("ORD-" + order.getId() + "-REFUND-" + MERCHANT_1));
        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("PAYMENT_DECLINED"),
                eq(OrderStatusHistory.ACTOR_RECOVERY_JOB), eq(true));
    }

    @Test
    @DisplayName("a stuck split order with one unresolved merchant is left exactly as it is")
    void stuckSplitOrderWithAnUnknownLineIsLeftAlone() {
        List<OrderPayment> lines = splitOrder();
        order.markPaymentRequested();
        lines.get(0).markCompleted(
                payment(MERCHANT_1_PAYMENT, PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE));
        // The second line has no payment id and the payment service cannot be asked:
        // money may be in flight, so nothing is decided.
        when(paymentClient.findByOrderId(order.getId()))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "timeout"));

        assertThat(saga.recoverStuckCheckouts()).isZero();

        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(catalogClient, never()).release(anyString(), anyString());
        verify(paymentClient, never()).refund(anyString(), anyString(), anyString());
    }

    private static PaymentOutcome payment(PaymentStatus status, long amountMinor) {
        return new PaymentOutcome("payment-1", "PAY-1", status, amountMinor, "KZT", null, null);
    }

    private static PaymentOutcome payment(String paymentId, PaymentStatus status, long amountMinor) {
        return new PaymentOutcome(paymentId, "PAY-1", status, amountMinor, "KZT", null, null);
    }
}
