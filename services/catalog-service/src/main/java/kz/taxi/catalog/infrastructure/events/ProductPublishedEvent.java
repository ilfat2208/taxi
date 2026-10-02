package kz.taxi.catalog.infrastructure.events;

/**
 * A merchant published an offer.
 *
 * <p>Deliberately flat and small: consumers (search index, recommendations) need
 * enough to build their own read model without calling back into the catalog.
 */
public record ProductPublishedEvent(
        String productId,
        String merchantId,
        String title,
        String category,
        String brand,
        long priceMinor,
        String currency,
        String status
) {
}
