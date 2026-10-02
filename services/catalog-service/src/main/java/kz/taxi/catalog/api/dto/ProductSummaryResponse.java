package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ProductStatus;

/** One product as it appears in a catalog list. */
public record ProductSummaryResponse(
        String id,
        String merchantId,
        String merchantName,
        String title,
        String description,
        String category,
        String brand,
        long priceMinor,
        String currency,
        String imageUrl,
        ProductStatus status,
        int availableQuantity
) {
}
