package kz.taxi.catalog.infrastructure.events;

import java.time.Instant;
import java.util.List;

/** Stock was held for a checkout; the order may now be paid. */
public record StockReservedEvent(
        String orderId,
        String currency,
        long subtotalMinor,
        Instant expiresAt,
        List<StockEventLine> items
) {
}
