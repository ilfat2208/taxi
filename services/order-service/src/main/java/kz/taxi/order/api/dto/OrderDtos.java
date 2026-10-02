package kz.taxi.order.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * Order API payloads.
 *
 * <p>Amounts leave this service in minor units and nothing else: a JSON number
 * like {@code 12599.99} would be parsed as a double by half the clients in the
 * world, and the platform's rule is that money is an integer plus a currency code.
 */
public final class OrderDtos {

    private OrderDtos() {
    }

    /**
     * Starts a checkout.
     *
     * <p>{@code sourceAccountId} is required because the money has to come from
     * somewhere: the order service never picks an account on the customer's behalf.
     */
    public record CheckoutRequest(@Size(max = 512) String deliveryAddress,
                                  @Size(max = 32) String contactPhone,
                                  @Size(max = 512) String comment,
                                  @NotBlank @Size(max = 26) String sourceAccountId) {
    }

    /** Optional reason, recorded in the order's history so support can explain a cancellation. */
    public record CancelOrderRequest(@Size(max = 512) String reason) {
    }

    public record OrderItemResponse(String itemId,
                                    String productId,
                                    String merchantId,
                                    String title,
                                    long unitPriceMinor,
                                    int quantity,
                                    long lineTotalMinor,
                                    String currency) {
    }

    public record OrderHistoryResponse(String fromStatus,
                                       String toStatus,
                                       String reason,
                                       String actor,
                                       Instant createdAt) {
    }

    /**
     * One merchant's payment of an order.
     *
     * <p>An order is charged once per merchant, because the payment contract and the
     * settlement ledger are per merchant. {@code amountMinor} is what that merchant is
     * charged (the delivery fee travels with one of them), {@code feeMinor} the
     * platform's fee on it and {@code totalMinor} what the payer is debited for that
     * merchant. {@code paymentId} is null while the payment has not been created yet,
     * which is the state a partly completed checkout is in.
     */
    public record OrderPaymentResponse(String merchantId,
                                       String paymentId,
                                       String status,
                                       long amountMinor,
                                       long feeMinor,
                                       long totalMinor,
                                       String currency) {
    }

    /**
     * One order, in full.
     *
     * <p>{@code sagaState} is exposed on purpose: it is what tells a support
     * engineer whether {@code PENDING_PAYMENT} means "no payment yet" or "the
     * payment outcome is unknown", and it costs nothing to include.
     *
     * <p>{@code paymentId} keeps its meaning from before split payments — the first
     * payment of the order, in ascending merchant order — so an existing client reads
     * the same field it always did; {@code payments} carries the rest of them.
     */
    public record OrderResponse(String orderId,
                                String orderNumber,
                                String status,
                                String sagaState,
                                String currency,
                                long subtotalMinor,
                                long deliveryFeeMinor,
                                long totalMinor,
                                String paymentId,
                                String paymentStatus,
                                String failureReason,
                                String deliveryAddress,
                                String contactPhone,
                                String comment,
                                int itemCount,
                                List<OrderItemResponse> items,
                                List<OrderPaymentResponse> payments,
                                List<OrderHistoryResponse> history,
                                Instant createdAt,
                                Instant updatedAt,
                                Instant paidAt) {
    }

    /** Row shape of the order list: no line items, one query per page. */
    public record OrderSummaryResponse(String orderId,
                                       String orderNumber,
                                       String status,
                                       String currency,
                                       long totalMinor,
                                       int itemCount,
                                       String failureReason,
                                       Instant createdAt,
                                       Instant paidAt) {
    }
}
