package kz.taxi.catalog.infrastructure.events;

import java.util.List;

/** Payment settled: the goods are sold and have left the warehouse. */
public record StockCommittedEvent(
        String orderId,
        String currency,
        long subtotalMinor,
        List<StockEventLine> items
) {
}
