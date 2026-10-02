package kz.taxi.order.application;

import kz.taxi.common.core.money.Money;
import kz.taxi.order.api.dto.CartDtos;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartItem;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderItem;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.OrderTotals;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Domain to DTO mapping.
 *
 * <p>Entities never leave the service: they carry lazy associations and a
 * persistence identity that would turn into a JSON serialization incident (or an
 * information leak) the moment they were returned from a controller. Mapping here
 * also keeps every "what does the client see" decision in one file.
 */
@Component
public class OrderMapper {

    // ------------------------------------------------------------------ cart

    public CartDtos.CartResponse toResponse(Cart cart, List<CartItem> items) {
        return new CartDtos.CartResponse(
                cart.getId(),
                cart.getStatus().name(),
                cart.getCurrency().name(),
                items.stream().mapToInt(CartItem::getQuantity).sum(),
                subtotalOf(cart, items).minorUnits(),
                items.stream().map(this::toResponse).toList(),
                cart.getUpdatedAt());
    }

    public CartDtos.CartItemResponse toResponse(CartItem item) {
        return new CartDtos.CartItemResponse(
                item.getId(),
                item.getProductId(),
                item.getMerchantId(),
                item.getTitle(),
                item.getImageUrl(),
                item.getUnitPriceMinor(),
                item.getQuantity(),
                item.lineTotalMinor(),
                item.getCurrency().name());
    }

    // ------------------------------------------------------------------ orders

    public OrderDtos.OrderResponse toResponse(CustomerOrder order,
                                              List<OrderItem> items,
                                              List<OrderPayment> payments,
                                              List<OrderStatusHistory> history) {
        return new OrderDtos.OrderResponse(
                order.getId(),
                order.getOrderNumber(),
                order.getStatus().name(),
                order.getSagaState() == null ? null : order.getSagaState().name(),
                order.currencyCode(),
                order.getSubtotalMinor(),
                order.getDeliveryFeeMinor(),
                order.getTotalMinor(),
                order.getPaymentId(),
                order.getPaymentStatus(),
                order.getFailureReason(),
                order.getDeliveryAddress(),
                order.getContactPhone(),
                order.getComment(),
                items.stream().mapToInt(OrderItem::getQuantity).sum(),
                items.stream().map(this::toResponse).toList(),
                payments.stream().map(this::toResponse).toList(),
                history.stream().map(this::toResponse).toList(),
                order.getCreatedAt(),
                order.getUpdatedAt(),
                order.getPaidAt());
    }

    /**
     * One merchant's payment of an order.
     *
     * <p>{@code paymentId} leaves as null until the payment exists: a client that
     * shows "waiting for the seller's bank" must be able to tell that apart from a
     * payment that was refused, which is what {@code status} says.
     */
    public OrderDtos.OrderPaymentResponse toResponse(OrderPayment payment) {
        return new OrderDtos.OrderPaymentResponse(
                payment.getMerchantId(),
                payment.getPaymentId(),
                payment.getStatus().name(),
                payment.getAmountMinor(),
                payment.getFeeMinor(),
                payment.getTotalMinor(),
                payment.currencyCode());
    }

    public OrderDtos.OrderItemResponse toResponse(OrderItem item) {
        return new OrderDtos.OrderItemResponse(
                item.getId(),
                item.getProductId(),
                item.getMerchantId(),
                item.getTitle(),
                item.getUnitPriceMinor(),
                item.getQuantity(),
                item.getLineTotalMinor(),
                item.getCurrency().name());
    }

    public OrderDtos.OrderHistoryResponse toResponse(OrderStatusHistory history) {
        return new OrderDtos.OrderHistoryResponse(
                history.getFromStatus() == null ? null : history.getFromStatus().name(),
                history.getToStatus().name(),
                history.getReason(),
                history.getActor(),
                history.getCreatedAt());
    }

    public OrderDtos.OrderSummaryResponse toSummary(CustomerOrder order, int itemCount) {
        return new OrderDtos.OrderSummaryResponse(
                order.getId(),
                order.getOrderNumber(),
                order.getStatus().name(),
                order.currencyCode(),
                order.getTotalMinor(),
                itemCount,
                order.getFailureReason(),
                order.getCreatedAt(),
                order.getPaidAt());
    }

    /**
     * Sums the lines through {@link OrderTotals}, so the cart page and the checkout
     * quote the same arithmetic. An empty cart has no lines to take a currency from,
     * and reports the cart's own currency.
     */
    private static Money subtotalOf(Cart cart, List<CartItem> items) {
        return items.isEmpty()
                ? Money.zero(cart.getCurrency())
                : OrderTotals.ofCartItems(items, 0L).subtotal();
    }
}
