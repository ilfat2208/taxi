package kz.taxi.order;

import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartItem;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderItem;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderTotals;
import kz.taxi.order.domain.ProductSnapshot;

import java.time.Instant;
import java.util.List;

/**
 * Builders shared by the unit and integration tests.
 *
 * <p>Entities are created through their real factories, never with setters that do
 * not exist: a test that cannot build an order the way production does is a test
 * that does not prove much.
 */
public final class OrderFixtures {

    public static final String USER_ID = "user-1";
    public static final String OTHER_USER_ID = "user-2";
    public static final String MERCHANT_ID = "merchant-1";
    public static final String CART_KEY = "idem-cart-key";
    public static final String CHECKOUT_KEY = "idem-checkout-key";

    private OrderFixtures() {
    }

    // ------------------------------------------------------------------ cart

    public static Cart cart(String userId) {
        return Cart.open(userId, Currency.KZT);
    }

    public static CartItem cartItem(String cartId, String productId, long unitPriceMinor, int quantity) {
        return CartItem.of(cartId, productId, snapshot(productId, unitPriceMinor), quantity);
    }

    public static ProductSnapshot snapshot(String productId, long unitPriceMinor) {
        return new ProductSnapshot(MERCHANT_ID, "Title " + productId, "https://cdn.test/" + productId + ".png",
                unitPriceMinor, Currency.KZT);
    }

    // ------------------------------------------------------------------ orders

    public static OrderTotals totals(long subtotalMinor) {
        return OrderTotals.of(Money.ofMinor(subtotalMinor, Currency.KZT), 0L);
    }

    public static OrderTotals totals(long subtotalMinor, long deliveryFeeMinor) {
        return OrderTotals.of(Money.ofMinor(subtotalMinor, Currency.KZT), deliveryFeeMinor);
    }

    public static CustomerOrder pendingOrder(String userId, long subtotalMinor) {
        return pendingOrder(userId, subtotalMinor, 0L);
    }

    public static CustomerOrder pendingOrder(String userId, long subtotalMinor, long deliveryFeeMinor) {
        return CustomerOrder.create("ORD-250101-00001", userId, Currency.KZT,
                totals(subtotalMinor, deliveryFeeMinor),
                CHECKOUT_KEY, "hash", "Almaty, Abay 1", "+77000000000", null, "corr-1");
    }

    public static CustomerOrder pendingOrder(String userId) {
        return pendingOrder(userId, 10_000L);
    }

    public static OrderItem orderItem(String orderId, String productId, long unitPriceMinor, int quantity) {
        return orderItem(orderId, productId, MERCHANT_ID, unitPriceMinor, quantity);
    }

    public static OrderItem orderItem(String orderId, String productId, String merchantId,
                                      long unitPriceMinor, int quantity) {
        return OrderItem.of(orderId, productId, merchantId, "Title " + productId, unitPriceMinor, quantity,
                Currency.KZT);
    }

    // ------------------------------------------------------------------ payments

    /** One merchant's payment line of an order, as the checkout writes it down before charging. */
    public static OrderPayment paymentLine(String orderId, String merchantId, long amountMinor) {
        return OrderPayment.pending(orderId, merchantId, amountMinor, Currency.KZT);
    }

    public static OrderDtos.OrderPaymentResponse paymentResponse(String merchantId, String paymentId,
                                                                 String status, long amountMinor) {
        return new OrderDtos.OrderPaymentResponse(merchantId, paymentId, status, amountMinor, 0L,
                amountMinor, "KZT");
    }

    public static OrderDtos.OrderResponse response(String orderId, String status) {
        return response(orderId, status, List.of());
    }

    /** The same response, with the per-merchant payments the order was charged as. */
    public static OrderDtos.OrderResponse response(String orderId,
                                                   String status,
                                                   List<OrderDtos.OrderPaymentResponse> payments) {
        return new OrderDtos.OrderResponse(orderId, "ORD-250101-00001", status, "NEW", "KZT",
                10_000L, 0L, 10_000L, payments.isEmpty() ? null : payments.get(0).paymentId(), null, null,
                null, null, null, 1, List.of(), payments, List.of(), Instant.now(), Instant.now(), null);
    }
}
