package kz.taxi.catalog.infrastructure.events;

import java.util.List;

/**
 * Held stock went back to the sellable pool.
 *
 * <p>{@code reason} distinguishes the three ways a hold ends without a sale:
 * the checkout was abandoned, the payment failed, or nobody paid before the
 * reservation expired. Consumers that count "released" stock need that
 * distinction; the stock counters do not care.
 */
public record StockReleasedEvent(
        String orderId,
        String reason,
        String currency,
        long subtotalMinor,
        List<StockEventLine> items
) {

    public static final String REASON_ABANDONED = "ABANDONED";
    public static final String REASON_PAYMENT_FAILED = "PAYMENT_FAILED";
    public static final String REASON_EXPIRED = "EXPIRED";
    /** No reason was supplied; better an explicit "unknown" than a guess. */
    public static final String REASON_UNSPECIFIED = "UNSPECIFIED";
}
