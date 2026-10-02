package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ProductStatus;

/**
 * The product card.
 *
 * <p>Adds what the list cannot afford to compute per row: the seller block and the
 * full stock triple. {@code onHand}/{@code reserved} are shown to the owning
 * merchant and to support; a shopper only reads {@code availableQuantity}.
 */
public record ProductDetailResponse(
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
        int availableQuantity,
        MerchantSummaryResponse merchant,
        int onHand,
        int reserved,
        int available
) {
}
