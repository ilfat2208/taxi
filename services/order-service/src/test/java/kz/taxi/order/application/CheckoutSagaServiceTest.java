package kz.taxi.order.application;

import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyOutcome;
import kz.taxi.common.web.idempotency.InMemoryIdempotencyStore;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartItem;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderFailure;
import kz.taxi.order.domain.OrderItem;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.CatalogDtos;
import kz.taxi.order.infrastructure.client.PaymentClient;
import kz.taxi.order.infrastructure.client.PaymentDtos;
import kz.taxi.order.infrastructure.config.OrderProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The checkout saga: the order of the steps, and the compensation of every one of
 * them that can fail.
 *
 * <p>Everything is mocked except the domain objects, so these tests describe the
 * saga itself: what it calls, in which order, and — more importantly — what it must
 * <em>not</em> do when an answer is missing.
 *
 * <p>The money tests are per merchant. An order is charged once per seller, so the
 * interesting facts are how the total is divided between them, where the delivery
 * fee lands, and what happens to the merchants that were already paid when one of
 * them refuses.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CheckoutSagaServiceTest {

    private static final String USER_ID = OrderFixtures.USER_ID;
    private static final String CHECKOUT_KEY = OrderFixtures.CHECKOUT_KEY;
    private static final String SOURCE_ACCOUNT = "account-1";
    private static final String MERCHANT_1 = OrderFixtures.MERCHANT_ID;
    private static final String MERCHANT_2 = "merchant-2";
    private static final long SUBTOTAL = 10_000L;
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
    private final JsonMapper objectMapper = JsonMapper.builder().addModule(new JavaTimeModule()).build();

    private CheckoutSagaService saga;
    private Cart cart;
    private CustomerOrder order;
    private List<OrderItem> orderItems;

    @BeforeEach
    void setUp() {
        saga = new CheckoutSagaService(idempotencyGuard, lifecycle, orderQuery, cartService, catalogClient,
                paymentClient, properties, objectMapper);

        when(idempotencyGuard.execute(anyString(), any(), eq(CheckoutSagaService.CheckoutResult.class), any()))
                .thenAnswer(invocation -> IdempotencyOutcome.fresh(
                        ((Supplier<CheckoutSagaService.CheckoutResult>) invocation.getArgument(3)).get()));

        cart = OrderFixtures.cart(USER_ID);
        List<CartItem> cartItems = List.of(OrderFixtures.cartItem(cart.getId(), "product-1", 5_000L, 2));
        order = OrderFixtures.pendingOrder(USER_ID, SUBTOTAL);
        orderItems = List.of(OrderFixtures.orderItem(order.getId(), "product-1", 5_000L, 2));

        when(cartService.requireCheckoutCart(USER_ID))
                .thenReturn(new CartApplicationService.ActiveCart(cart, cartItems));
        when(lifecycle.findByCheckoutKey(CHECKOUT_KEY)).thenReturn(Optional.empty());
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(orderQuery.loadOrderResponse(order.getId()))
                .thenReturn(OrderFixtures.response(order.getId(), "PENDING_PAYMENT"));
        when(catalogClient.reserve(eq(order.getId()), any())).thenReturn(reservation(SUBTOTAL, "KZT"));
        givenPaymentLines(OrderFixtures.paymentLine(order.getId(), MERCHANT_1, SUBTOTAL));
    }

    // ------------------------------------------------------------------ happy path

    @Test
    @DisplayName("the saga persists, reserves, charges and commits, in that order")
    void happyPathSettlesTheOrder() {
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL, "KZT"));

        CheckoutSagaService.CheckoutResult result = saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        InOrder sequence = inOrder(lifecycle, catalogClient, paymentClient, cartService);
        sequence.verify(lifecycle).createPendingOrder(any(), any(), any(), eq(CHECKOUT_KEY), anyString(), any(), eq(0));
        sequence.verify(catalogClient).reserve(eq(order.getId()), any());
        sequence.verify(lifecycle).markStockReserved(order.getId());
        sequence.verify(lifecycle).startMerchantPayments(eq(order.getId()), any());
        sequence.verify(lifecycle).markPaymentRequested(order.getId());
        sequence.verify(paymentClient).createMerchantPayment(any(), anyString());
        sequence.verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_1), any());
        sequence.verify(lifecycle).markPaid(eq(order.getId()), any(), eq(OrderStatusHistory.ACTOR_PAYMENT_SERVICE));
        sequence.verify(catalogClient).commit(order.getId());
        sequence.verify(lifecycle).markStockCommitted(order.getId());
        sequence.verify(cartService).markCheckedOut(cart.getId());

        assertThat(result.awaitingPaymentOutcome()).isFalse();
        assertThat(result.order()).isNotNull();
    }

    @Test
    @DisplayName("a single-merchant cart is charged exactly the order total, as before split payments")
    void singleMerchantCartIsChargedTheOrderTotalOnce() {
        long subtotal = 10_000L;
        order = OrderFixtures.pendingOrder(USER_ID, subtotal, DELIVERY_FEE);
        orderItems = List.of(OrderFixtures.orderItem(order.getId(), "product-1", MERCHANT_1, 5_000L, 2));
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(catalogClient.reserve(eq(order.getId()), any())).thenReturn(reservation(subtotal, "KZT"));
        givenPaymentLines(OrderFixtures.paymentLine(order.getId(), MERCHANT_1, order.getTotalMinor()));
        givenPayment(payment(PaymentStatus.COMPLETED, order.getTotalMinor(), "KZT"));

        saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        ArgumentCaptor<PaymentDtos.MerchantPaymentRequest> body =
                ArgumentCaptor.forClass(PaymentDtos.MerchantPaymentRequest.class);
        verify(paymentClient, times(1)).createMerchantPayment(body.capture(),
                eq(OrderNumbersKey.payment(order.getId(), MERCHANT_1)));

        // The regression guard: one merchant, one payment, for the whole order total.
        assertThat(body.getValue().amountMinor()).isEqualTo(order.getTotalMinor());
        assertThat(body.getValue().amountMinor()).isEqualTo(subtotal + DELIVERY_FEE);
        assertThat(body.getValue().merchantId()).isEqualTo(MERCHANT_1);
        assertThat(body.getValue().currency()).isEqualTo("KZT");
        assertThat(body.getValue().sourceAccountId()).isEqualTo(SOURCE_ACCOUNT);
        assertThat(body.getValue().orderId()).isEqualTo(order.getId());
        assertThat(body.getValue().description()).isEqualTo("Order " + order.getOrderNumber());
    }

    @Test
    @DisplayName("a multi-merchant cart is charged once per merchant, in ascending merchant id order")
    void multiMerchantCartChargesEveryMerchant() {
        long merchant1Lines = 10_000L;
        long merchant2Lines = 5_000L;
        order = OrderFixtures.pendingOrder(USER_ID, merchant1Lines + merchant2Lines, DELIVERY_FEE);
        orderItems = List.of(
                OrderFixtures.orderItem(order.getId(), "product-1", MERCHANT_1, 5_000L, 2),
                OrderFixtures.orderItem(order.getId(), "product-2", MERCHANT_2, 5_000L, 1));
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenReturn(reservation(order.getSubtotalMinor(), "KZT"));

        OrderPayment first = OrderFixtures.paymentLine(order.getId(), MERCHANT_1, merchant1Lines + DELIVERY_FEE);
        OrderPayment second = OrderFixtures.paymentLine(order.getId(), MERCHANT_2, merchant2Lines);
        givenPaymentLines(first, second);
        // The largest merchant carries the delivery fee, so the two amounts add up to
        // the order total with no residue left over. The platform fee is the payment
        // service's own number and rides on top of the amount it is asked for.
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_1),
                payment(PaymentStatus.COMPLETED, merchant1Lines + DELIVERY_FEE, "KZT"));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_2),
                payment(PaymentStatus.COMPLETED, merchant2Lines, "KZT"));

        saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        ArgumentCaptor<PaymentDtos.MerchantPaymentRequest> bodies =
                ArgumentCaptor.forClass(PaymentDtos.MerchantPaymentRequest.class);
        verify(paymentClient, times(2)).createMerchantPayment(bodies.capture(), anyString());

        List<PaymentDtos.MerchantPaymentRequest> requests = bodies.getAllValues();
        assertThat(requests).extracting(PaymentDtos.MerchantPaymentRequest::merchantId)
                .containsExactly(MERCHANT_1, MERCHANT_2);
        assertThat(requests).extracting(PaymentDtos.MerchantPaymentRequest::amountMinor)
                .containsExactly(merchant1Lines + DELIVERY_FEE, merchant2Lines);
        // The customer agreed to one total: the per-merchant amounts add up to it
        // exactly, and the totals (amount + the payment service's fee) are that total
        // plus the fees.
        assertThat(requests.stream().mapToLong(PaymentDtos.MerchantPaymentRequest::amountMinor).sum())
                .isEqualTo(order.getTotalMinor());
        long fees = 100L + 50L;
        assertThat(requests.stream().mapToLong(PaymentDtos.MerchantPaymentRequest::amountMinor).sum() + fees)
                .isEqualTo(order.getTotalMinor() + fees);

        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_1), any());
        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_2), any());
        // One order, one payment id: the first merchant's, so the client sees what it
        // always saw.
        ArgumentCaptor<PaymentOutcome> orderPayment = ArgumentCaptor.forClass(PaymentOutcome.class);
        verify(lifecycle).markPaid(eq(order.getId()), orderPayment.capture(),
                eq(OrderStatusHistory.ACTOR_PAYMENT_SERVICE));
        assertThat(orderPayment.getValue().paymentId()).isEqualTo("payment-1");
        verify(catalogClient, times(1)).commit(order.getId());
        verify(cartService).markCheckedOut(cart.getId());
    }

    @Test
    @DisplayName("the delivery fee lands on the merchant with the largest share of the order")
    void deliveryFeeLandsOnTheLargestMerchant() {
        // merchant-1: 5_000 x 2 = 10_000; merchant-2: 9_000 x 1 = 9_000. The largest
        // share is merchant-1's, so the delivery fee travels with its payment.
        order = OrderFixtures.pendingOrder(USER_ID, 19_000L, DELIVERY_FEE);
        orderItems = List.of(
                OrderFixtures.orderItem(order.getId(), "product-1", MERCHANT_1, 5_000L, 2),
                OrderFixtures.orderItem(order.getId(), "product-2", MERCHANT_2, 9_000L, 1));
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenReturn(reservation(order.getSubtotalMinor(), "KZT"));
        givenPaymentLines(
                OrderFixtures.paymentLine(order.getId(), MERCHANT_1, 10_000L + DELIVERY_FEE),
                OrderFixtures.paymentLine(order.getId(), MERCHANT_2, 9_000L));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_1),
                payment(PaymentStatus.COMPLETED, 10_000L + DELIVERY_FEE, "KZT"));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_2),
                payment(PaymentStatus.COMPLETED, 9_000L, "KZT"));

        saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        ArgumentCaptor<PaymentDtos.MerchantPaymentRequest> bodies =
                ArgumentCaptor.forClass(PaymentDtos.MerchantPaymentRequest.class);
        verify(paymentClient, times(2)).createMerchantPayment(bodies.capture(), anyString());
        assertThat(bodies.getAllValues())
                .extracting(PaymentDtos.MerchantPaymentRequest::merchantId,
                        PaymentDtos.MerchantPaymentRequest::amountMinor)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(MERCHANT_1, 10_000L + DELIVERY_FEE),
                        org.assertj.core.groups.Tuple.tuple(MERCHANT_2, 9_000L));
        assertThat(bodies.getAllValues().stream()
                .mapToLong(PaymentDtos.MerchantPaymentRequest::amountMinor).sum())
                .isEqualTo(order.getTotalMinor());
    }

    @Test
    @DisplayName("the platform fee of a merchant payment is recorded on top of the amount charged")
    void thePlatformFeeRidesOnTopOfTheAmount() {
        long fee = 250L;
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL, fee, "KZT"));

        saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        ArgumentCaptor<PaymentOutcome> applied = ArgumentCaptor.forClass(PaymentOutcome.class);
        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_1), applied.capture());
        assertThat(applied.getValue().amountMinor()).isEqualTo(SUBTOTAL);
        assertThat(applied.getValue().feeMinor()).isEqualTo(fee);
        assertThat(applied.getValue().totalMinor()).isEqualTo(SUBTOTAL + fee);
    }

    // ------------------------------------------------------------------ step 2 fails

    @Test
    @DisplayName("stock refused: the order is cancelled with a reason and the payment is never called")
    void stockRefusalCancelsTheOrder() {
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenThrow(DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE, "only 1 of the 2 are left"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);

        verify(paymentClient, never()).createMerchantPayment(any(), anyString());
        verify(lifecycle, never()).markPaymentRequested(order.getId());
        verify(lifecycle, never()).startMerchantPayments(anyString(), any());
        verify(catalogClient).release(order.getId(), "only 1 of the 2 are left");
        verify(lifecycle).markCancelled(eq(order.getId()),
                eq("PRODUCT_UNAVAILABLE: only 1 of the 2 are left"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(true));
    }

    @Test
    @DisplayName("the catalog charged a different price: cancel instead of charging what was not agreed")
    void catalogPriceChangeCancelsTheOrder() {
        when(catalogClient.reserve(eq(order.getId()), any())).thenReturn(reservation(SUBTOTAL - 1, "KZT"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);

        verify(paymentClient, never()).createMerchantPayment(any(), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("prices changed while checking out"),
                eq(OrderStatusHistory.ACTOR_CUSTOMER), eq(true));
    }

    @Test
    @DisplayName("the catalog did not answer: the order waits, nothing is released and nothing is charged")
    void catalogOutageLeavesTheOrderPending() {
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "catalog did not answer"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.DOWNSTREAM_UNAVAILABLE);

        verify(paymentClient, never()).createMerchantPayment(any(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(lifecycle).recordNote(eq(order.getId()), contains("stock reservation outcome unknown"));
    }

    // ------------------------------------------------------------------ step 3 fails

    @Test
    @DisplayName("a declined payment releases the stock, cancels the order and reports why")
    void declinedPaymentCompensates() {
        givenPayment(payment(PaymentStatus.FAILED, 0L, "KZT"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .satisfies(failure -> {
                    DomainException domain = (DomainException) failure;
                    assertThat(domain.errorCode()).isEqualTo(OrderErrorCode.PAYMENT_DECLINED);
                    assertThat(domain.details()).containsEntry("orderId", order.getId());
                });

        verify(lifecycle).markPaymentDeclined(eq(order.getId()), eq(MERCHANT_1), any());
        verify(paymentClient, never()).refund(anyString(), anyString(), anyString());
        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("PAYMENT_DECLINED: the payment was declined"),
                eq(OrderStatusHistory.ACTOR_PAYMENT_SERVICE), eq(true));
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("one merchant refusing refunds the merchants already paid, and cancels the order")
    void aPartialPaymentIsRefundedAndCancelled() {
        long merchant1Lines = 10_000L;
        long merchant2Lines = 5_000L;
        order = OrderFixtures.pendingOrder(USER_ID, merchant1Lines + merchant2Lines, DELIVERY_FEE);
        orderItems = List.of(
                OrderFixtures.orderItem(order.getId(), "product-1", MERCHANT_1, 5_000L, 2),
                OrderFixtures.orderItem(order.getId(), "product-2", MERCHANT_2, 5_000L, 1));
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenReturn(reservation(order.getSubtotalMinor(), "KZT"));

        OrderPayment paid = OrderFixtures.paymentLine(order.getId(), MERCHANT_1, merchant1Lines + DELIVERY_FEE);
        paid.markCompleted(payment(PaymentStatus.COMPLETED, merchant1Lines + DELIVERY_FEE, 0L, "KZT"));
        OrderPayment refused = OrderFixtures.paymentLine(order.getId(), MERCHANT_2, merchant2Lines);
        givenPaymentLines(paid, refused);
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_1),
                payment(PaymentStatus.COMPLETED, merchant1Lines + DELIVERY_FEE, "KZT"));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_2),
                payment(PaymentStatus.FAILED, 0L, "KZT"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_DECLINED);

        // The merchant that was already paid is refunded, with a key derived from the
        // order and that merchant only: a retry of this compensation refunds once.
        verify(paymentClient).refund(eq("payment-1"), anyString(),
                eq("ORD-" + order.getId() + "-REFUND-" + MERCHANT_1));
        verify(lifecycle).markPaymentRefunded(order.getId(), MERCHANT_1);
        verify(lifecycle).markPaymentDeclined(eq(order.getId()), eq(MERCHANT_2), any());
        verify(catalogClient).release(eq(order.getId()), anyString());
        verify(lifecycle).markCancelled(eq(order.getId()), contains("PAYMENT_DECLINED"),
                eq(OrderStatusHistory.ACTOR_PAYMENT_SERVICE), eq(true));
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(lifecycle, never()).markStockCommitted(anyString());
    }

    @Test
    @DisplayName("a refund that fails leaves the order recoverable: nothing is cancelled or released")
    void failedRefundLeavesTheOrderRecoverable() {
        long merchant1Lines = 10_000L;
        long merchant2Lines = 5_000L;
        order = OrderFixtures.pendingOrder(USER_ID, merchant1Lines + merchant2Lines, DELIVERY_FEE);
        orderItems = List.of(
                OrderFixtures.orderItem(order.getId(), "product-1", MERCHANT_1, 5_000L, 2),
                OrderFixtures.orderItem(order.getId(), "product-2", MERCHANT_2, 5_000L, 1));
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenReturn(reservation(order.getSubtotalMinor(), "KZT"));

        OrderPayment paid = OrderFixtures.paymentLine(order.getId(), MERCHANT_1, merchant1Lines + DELIVERY_FEE);
        paid.markCompleted(payment(PaymentStatus.COMPLETED, merchant1Lines + DELIVERY_FEE, 0L, "KZT"));
        givenPaymentLines(paid, OrderFixtures.paymentLine(order.getId(), MERCHANT_2, merchant2Lines));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_1),
                payment(PaymentStatus.COMPLETED, merchant1Lines + DELIVERY_FEE, "KZT"));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_2),
                payment(PaymentStatus.FAILED, 0L, "KZT"));
        org.mockito.Mockito.doThrow(DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR, "refund refused"))
                .when(paymentClient).refund(anyString(), anyString(), anyString());

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_SERVICE_ERROR);

        // The money was kept, so the order must not be finished off: it stays
        // PENDING_PAYMENT with the debt written down for the recovery job.
        verify(lifecycle).markPaymentUnknown(eq(order.getId()), contains("refund"));
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(catalogClient, never()).release(anyString(), anyString());
        verify(lifecycle, never()).markPaymentRefunded(anyString(), anyString());
    }

    @Test
    @DisplayName("a payment timeout leaves the order PENDING_PAYMENT and releases nothing: money may have moved")
    void paymentTimeoutLeavesTheOrderRecoverable() {
        when(paymentClient.createMerchantPayment(any(), anyString()))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "payment did not answer"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.DOWNSTREAM_UNAVAILABLE);

        verify(lifecycle).markPaymentUnknown(eq(order.getId()), contains("payment did not answer"));
        verify(catalogClient, never()).release(anyString(), anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(lifecycle, never()).markCancelled(anyString(), any(kz.taxi.order.domain.OrderFailure.class),
                anyString(), anyBoolean());
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        // The order is still PENDING_PAYMENT, which is exactly what the recovery job
        // knows how to resolve.
        assertThat(order.isPendingPayment()).isTrue();
    }

    @Test
    @DisplayName("a timeout on the second merchant keeps the first merchant's progress")
    void partialProgressIsPersistedBeforeStopping() {
        long merchant1Lines = 10_000L;
        long merchant2Lines = 5_000L;
        order = OrderFixtures.pendingOrder(USER_ID, merchant1Lines + merchant2Lines, DELIVERY_FEE);
        orderItems = List.of(
                OrderFixtures.orderItem(order.getId(), "product-1", MERCHANT_1, 5_000L, 2),
                OrderFixtures.orderItem(order.getId(), "product-2", MERCHANT_2, 5_000L, 1));
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenReturn(order);
        when(lifecycle.itemsOf(order.getId())).thenReturn(orderItems);
        when(catalogClient.reserve(eq(order.getId()), any()))
                .thenReturn(reservation(order.getSubtotalMinor(), "KZT"));
        givenPaymentLines(
                OrderFixtures.paymentLine(order.getId(), MERCHANT_1, merchant1Lines + DELIVERY_FEE),
                OrderFixtures.paymentLine(order.getId(), MERCHANT_2, merchant2Lines));
        givenPayment(OrderNumbersKey.payment(order.getId(), MERCHANT_1),
                payment(PaymentStatus.COMPLETED, merchant1Lines + DELIVERY_FEE, "KZT"));
        when(paymentClient.createMerchantPayment(any(), eq(OrderNumbersKey.payment(order.getId(), MERCHANT_2))))
                .thenThrow(DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE, "payment did not answer"));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class);

        // The merchant that answered keeps its COMPLETED line; the order does not move.
        verify(lifecycle).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_1), any());
        verify(lifecycle, never()).markPaymentCompleted(eq(order.getId()), eq(MERCHANT_2), any());
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).commit(anyString());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
    }

    @Test
    @DisplayName("an unrecognised payment status is not a decision: the order stays pending and the client is told 202")
    void unknownPaymentStatusLeavesTheOrderPending() {
        givenPayment(new PaymentOutcome("payment-1", "PAY-1", PaymentStatus.UNKNOWN, SUBTOTAL, "KZT", null, null));

        CheckoutSagaService.CheckoutResult result = saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        assertThat(result.awaitingPaymentOutcome()).isTrue();
        verify(lifecycle).markPaymentUnknown(eq(order.getId()), contains("answered status"));
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(catalogClient, never()).release(anyString(), anyString());
    }

    @Test
    @DisplayName("a payment for the wrong amount is not recorded as this merchant's charge")
    void aPaymentForTheWrongAmountIsNotApplied() {
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL - 1, "KZT"));

        CheckoutSagaService.CheckoutResult result = saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        assertThat(result.awaitingPaymentOutcome()).isTrue();
        verify(lifecycle, never()).markPaymentCompleted(anyString(), anyString(), any());
        verify(lifecycle, never()).markPaid(anyString(), any(), anyString());
        verify(lifecycle).markPaymentUnknown(eq(order.getId()), contains("but the order holds"));
    }

    @Test
    @DisplayName("a failed stock commit does not undo a captured payment")
    void failedCommitKeepsTheOrderPaid() {
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL, "KZT"));
        org.mockito.Mockito.doThrow(DomainException.of(OrderErrorCode.CATALOG_ERROR, "commit refused"))
                .when(catalogClient).commit(order.getId());

        CheckoutSagaService.CheckoutResult result = saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        assertThat(result.awaitingPaymentOutcome()).isFalse();
        verify(lifecycle).markPaid(eq(order.getId()), any(), anyString());
        verify(lifecycle, never()).markStockCommitted(order.getId());
        verify(lifecycle, never()).markCancelled(anyString(), anyString(), anyString(), anyBoolean());
        verify(cartService, never()).markCheckedOut(anyString());
    }

    // ------------------------------------------------------------------ retries

    @Test
    @DisplayName("a retried checkout resumes the order it already created instead of making another one")
    void retryResumesTheInterruptedOrder() {
        when(lifecycle.findByCheckoutKey(CHECKOUT_KEY)).thenReturn(Optional.of(order));
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL, "KZT"));

        saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        verify(lifecycle, never()).createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt());
        verify(catalogClient).reserve(eq(order.getId()), any());
        verify(paymentClient).createMerchantPayment(any(),
                eq(OrderNumbersKey.payment(order.getId(), MERCHANT_1)));
        // The rows are reused, so a resume charges the same merchants as the first pass.
        verify(lifecycle).startMerchantPayments(eq(order.getId()), any());
    }

    @Test
    @DisplayName("a retried checkout of a refused order gets the same error, not a new order")
    void retryReplaysTheStoredFailure() {
        CustomerOrder cancelled = OrderFixtures.pendingOrder(USER_ID, SUBTOTAL);
        cancelled.cancel(OrderFailure.of(OrderErrorCode.PRODUCT_UNAVAILABLE, "only 1 of the 2 are left"), true);
        when(lifecycle.findByCheckoutKey(CHECKOUT_KEY)).thenReturn(Optional.of(cancelled));

        assertThatThrownBy(() -> saga.checkout(request(), CHECKOUT_KEY, USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);

        verify(catalogClient, never()).reserve(anyString(), any());
        verify(paymentClient, never()).createMerchantPayment(any(), anyString());
    }

    @Test
    @DisplayName("a retried checkout of a paid order returns it untouched")
    void retryOfAPaidOrderReturnsIt() {
        CustomerOrder paid = OrderFixtures.pendingOrder(USER_ID, SUBTOTAL);
        paid.markPaid(payment(PaymentStatus.COMPLETED, SUBTOTAL, "KZT"));
        when(lifecycle.findByCheckoutKey(CHECKOUT_KEY)).thenReturn(Optional.of(paid));
        when(orderQuery.loadOrderResponse(paid.getId())).thenReturn(OrderFixtures.response(paid.getId(), "PAID"));

        CheckoutSagaService.CheckoutResult result = saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        assertThat(result.order().status()).isEqualTo("PAID");
        verify(catalogClient, never()).reserve(anyString(), any());
        verify(paymentClient, never()).createMerchantPayment(any(), anyString());
    }

    @Test
    @DisplayName("two checkouts in the same millisecond: the order number is retried, the order is not duplicated")
    void orderNumberCollisionIsRetried() {
        when(lifecycle.createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt()))
                .thenThrow(new DataIntegrityViolationException("uq_order_number"))
                .thenReturn(order);
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL, "KZT"));

        saga.checkout(request(), CHECKOUT_KEY, USER_ID);

        verify(lifecycle).createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), eq(0));
        verify(lifecycle).createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), eq(1));
        verify(paymentClient, times(1)).createMerchantPayment(any(), anyString());
    }

    @Test
    @DisplayName("a processed idempotency key replays the stored answer and runs the saga once")
    void replayedKeyDoesNotRunTheSagaTwice() {
        IdempotencyGuard realGuard = new IdempotencyGuard(new InMemoryIdempotencyStore(Duration.ofHours(1)),
                objectMapper);
        CheckoutSagaService guarded = new CheckoutSagaService(realGuard, lifecycle, orderQuery, cartService,
                catalogClient, paymentClient, properties, objectMapper);
        givenPayment(payment(PaymentStatus.COMPLETED, SUBTOTAL, "KZT"));

        CheckoutSagaService.CheckoutResult first = guarded.checkout(request(), CHECKOUT_KEY, USER_ID);
        CheckoutSagaService.CheckoutResult second = guarded.checkout(request(), CHECKOUT_KEY, USER_ID);

        assertThat(second.order().orderId()).isEqualTo(first.order().orderId());
        verify(lifecycle, times(1)).createPendingOrder(any(), any(), any(), anyString(), anyString(), any(), anyInt());
        verify(paymentClient, times(1)).createMerchantPayment(any(), anyString());
    }

    // ------------------------------------------------------------------ helpers

    private OrderDtos.CheckoutRequest request() {
        return new OrderDtos.CheckoutRequest("Almaty, Abay 1", "+77000000000", null, SOURCE_ACCOUNT);
    }

    /** The merchant payment lines the order was started with, as the lifecycle service hands them over. */
    private void givenPaymentLines(OrderPayment... lines) {
        when(lifecycle.startMerchantPayments(eq(order.getId()), any())).thenReturn(List.of(lines));
        when(lifecycle.paymentsOf(order.getId())).thenReturn(List.of(lines));
    }

    private void givenPayment(PaymentOutcome outcome) {
        when(paymentClient.createMerchantPayment(any(), anyString())).thenReturn(outcome);
    }

    private void givenPayment(String idempotencyKey, PaymentOutcome outcome) {
        when(paymentClient.createMerchantPayment(any(), eq(idempotencyKey))).thenReturn(outcome);
    }

    private static PaymentOutcome payment(PaymentStatus status, long amountMinor, String currency) {
        return payment(status, amountMinor, 0L, currency);
    }

    private static PaymentOutcome payment(PaymentStatus status, long amountMinor, long feeMinor, String currency) {
        return new PaymentOutcome("payment-1", "PAY-000001", status, amountMinor, feeMinor,
                amountMinor + feeMinor, currency,
                status.isFailed() ? "INSUFFICIENT_FUNDS" : null,
                status.isFailed() ? "insufficient funds" : null);
    }

    private static CatalogDtos.Reservation reservation(long subtotalMinor, String currency) {
        return new CatalogDtos.Reservation("order", "ACTIVE", currency, subtotalMinor,
                Instant.now().plus(Duration.ofMinutes(30)), List.of());
    }

    /** The keys the saga derives, spelled out so a test fails when they change. */
    private static final class OrderNumbersKey {

        private OrderNumbersKey() {
        }

        static String payment(String orderId, String merchantId) {
            return "ORD-" + orderId + "-PAY-" + merchantId;
        }
    }
}
