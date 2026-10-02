package kz.taxi.catalog.infrastructure.events;

/**
 * One product line inside a stock event.
 *
 * <p>Amounts are minor units plus a currency code, like everywhere else on the
 * platform: the order service must be able to sum lines of an event without ever
 * touching a {@code double}.
 */
public record StockEventLine(
        String productId,
        String merchantId,
        int quantity,
        long unitPriceMinor,
        long lineTotalMinor
) {
}
