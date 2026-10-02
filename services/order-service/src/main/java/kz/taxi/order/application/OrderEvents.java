package kz.taxi.order.application;

import java.time.Instant;

/**
 * Payloads published to {@code order.events}.
 *
 * <p>One flat record for all three lifecycle events instead of three shapes: a
 * consumer that reacts to an order's progress wants the same facts at every step
 * (what it is, what it costs, who it belongs to), and it must be able to react
 * without calling back into this service. {@code status} is what changed; the rest
 * is the context a notification or an analytics pipeline would otherwise have to
 * fetch.
 */
public final class OrderEvents {

    private OrderEvents() {
    }

    /**
     * @param status      the order status this event announces
     * @param paymentId   the payment that settled the order, null until there is one
     * @param itemCount   number of lines, so a consumer can size a notification
     *                    without loading the order
     * @param occurredAt  when the business fact happened, not when it was published
     */
    public record OrderLifecycle(String orderId,
                                 String orderNumber,
                                 String userId,
                                 String status,
                                 String currency,
                                 long subtotalMinor,
                                 long deliveryFeeMinor,
                                 long totalMinor,
                                 String paymentId,
                                 int itemCount,
                                 Instant occurredAt) {
    }
}
