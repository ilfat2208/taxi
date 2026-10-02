package kz.taxi.order.application;

import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyOutcome;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
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
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Cancellation, and the money rules around it.
 *
 * <p>The interesting cases are not "cancel a fresh order" but the three states a
 * cancellation has to distinguish: nothing was charged (release and cancel), the
 * customer was charged (refund first, and refuse to cancel if the refund fails), and
 * nobody knows (change nothing).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OrderCancellationTest {

    private static final String USER_ID = OrderFixtures.USER_ID;
    private static final long TOTAL = 10_000L;

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
        when(idempotencyGuard.execute(anyString(), any(), eq(OrderDtos.OrderResponse.class), any()))
                .thenAnswer(invocation -> IdempotencyOutcome.fresh(
                        ((Supplier<OrderDtos.OrderResponse>) invocation.getArgument(3)).get()));

        order = OrderFixtures.pendingOrder(USER_ID, TOTAL);
        when(lifecycle.requireOrder(order.getId())).thenReturn(order);
        when(orderQuery.loadOrderResponse(order.getId()))
                .thenReturn(OrderFixtures.response(order.getId(), "CANCELLED"));
    }

    private AuthenticatedUser owner() {
        return new AuthenticatedUser(USER_ID, "+77000000000", "Customer", Set.of("CUSTOMER"));
    }

    private AuthenticatedUser stranger() {
        return new AuthenticatedUser(OrderFixtures.OTHER_USER_ID, "+77000000001", "Stranger", Set.of("CUSTOMER"));
    }

    @Test
    @DisplayName("an order whose payment was never requested is released and cancelled")
    void cancelsBeforeAnyPayment() {
        OrderDtos.OrderResponse response = saga.cancel(order.getId(), "changed my mind", owner(), Optional.empty());

        assertThat(response.status()).isEqualTo("CANCELLED");
        verify(catalogClient).release(order.getId(), "cancelled: changed my mind");
        verify(lifecycle).markCancelled(eq(order.getId()), eq("cancelled: changed my mind"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(true));
        verifyNoInteractions(paymentClient);
    }

    @Test
    @DisplayName("a payment that was captured is refunded before the order is cancelled")
    void refundsACapturedPayment() {
        // The order is still PENDING_PAYMENT - the payment completed asynchronously -
        // and the customer cancels before the event was processed.
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, TOTAL)));

        saga.cancel(order.getId(), null, owner(), Optional.empty());

        verify(paymentClient).refund(eq("payment-1"), anyString(), eq("ORD-" + order.getId() + "-REFUND"));
        verify(catalogClient).release(order.getId(), "cancelled by the customer (payment refunded)");
        verify(lifecycle).markCancelled(eq(order.getId()), eq("cancelled by the customer (payment refunded)"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(true));
    }

    @Test
    @DisplayName("a payment that failed needs no refund: the stock is simply released")
    void failedPaymentNeedsNoRefund() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.of(payment(PaymentStatus.FAILED, 0L)));

        saga.cancel(order.getId(), "too late", owner(), Optional.empty());

        verify(paymentClient, never()).refund(anyString(), anyString(), anyString());
        verify(catalogClient).release(order.getId(), "cancelled: too late");
        verify(lifecycle).markCancelled(eq(order.getId()), eq("cancelled: too late"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(true));
    }

    @Test
    @DisplayName("an unknown payment outcome cancels nothing and asks the client to retry")
    void refusesToCancelWhileTheOutcomeIsUnknown() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId()))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "payment did not answer"));

        assertThatThrownBy(() -> saga.cancel(order.getId(), null, owner(), Optional.empty()))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_PENDING);

        verify(catalogClient, never()).release(anyString(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("a failed refund leaves the order alone: the customer is still charged")
    void failedRefundAbortsTheCancellation() {
        order.markPaymentRequested();
        when(paymentClient.findByOrderId(order.getId())).thenReturn(Optional.of(payment(PaymentStatus.COMPLETED, TOTAL)));
        org.mockito.Mockito.doThrow(DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR, "refund refused"))
                .when(paymentClient).refund(anyString(), anyString(), anyString());

        assertThatThrownBy(() -> saga.cancel(order.getId(), null, owner(), Optional.empty()))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_SERVICE_ERROR);

        verify(catalogClient, never()).release(anyString(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("cancelling twice returns the current state instead of an error")
    void cancellingAnAlreadyCancelledOrderIsFine() {
        order.cancelByUser("cancelled by the customer", true);

        OrderDtos.OrderResponse response = saga.cancel(order.getId(), null, owner(), Optional.empty());

        assertThat(response.status()).isEqualTo("CANCELLED");
        verify(catalogClient, never()).release(anyString(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("a paid order cannot be cancelled: the money moved")
    void paidOrderIsNotCancellable() {
        order.markPaid(payment(PaymentStatus.COMPLETED, TOTAL));

        assertThatThrownBy(() -> saga.cancel(order.getId(), null, owner(), Optional.empty()))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.ORDER_NOT_CANCELLABLE);

        verify(catalogClient, never()).release(anyString(), anyString());
    }

    @Test
    @DisplayName("another customer's order cannot be cancelled, and is not even confirmed to exist")
    void refusesAnotherUsersOrder() {
        assertThatThrownBy(() -> saga.cancel(order.getId(), null, stranger(), Optional.empty()))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode().code())
                .isEqualTo("FORBIDDEN");

        verify(catalogClient, never()).release(anyString(), anyString());
    }

    @Test
    @DisplayName("a supplied Idempotency-Key is honoured")
    void usesTheIdempotencyKeyWhenProvided() {
        saga.cancel(order.getId(), null, owner(), Optional.of("cancel-key"));

        verify(idempotencyGuard).execute(eq("cancel-key"), any(), eq(OrderDtos.OrderResponse.class), any());
        verify(lifecycle).markCancelled(eq(order.getId()), eq("cancelled by the customer"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(true));
    }

    @Test
    @DisplayName("a stock release that fails still cancels, and the debt stays visible in the saga state")
    void failedReleaseLeavesTheCompensationPending() {
        org.mockito.Mockito.doThrow(DomainException.of(OrderErrorCode.CATALOG_ERROR, "catalog refused"))
                .when(catalogClient).release(eq(order.getId()), anyString());

        saga.cancel(order.getId(), null, owner(), Optional.empty());

        verify(lifecycle).markCancelled(eq(order.getId()), eq("cancelled by the customer"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(false));
    }

    private static PaymentOutcome payment(PaymentStatus status, long amountMinor) {
        return new PaymentOutcome("payment-1", "PAY-1", status, amountMinor, "KZT",
                status.isFailed() ? "INSUFFICIENT_FUNDS" : null,
                status.isFailed() ? "insufficient funds" : null);
    }
}
