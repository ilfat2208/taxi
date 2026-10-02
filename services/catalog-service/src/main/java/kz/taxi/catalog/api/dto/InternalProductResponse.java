package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ProductStatus;

/**
 * The narrow product view the order service is allowed to see.
 *
 * <p>No title search, no description, no attributes: the order service needs to
 * price a line and know whether it is sellable, and nothing more. Keeping the
 * internal contract small means the catalog can reshape its public catalog page
 * without breaking checkout.
 */
public record InternalProductResponse(
        String id,
        String merchantId,
        String title,
        long priceMinor,
        String currency,
        ProductStatus status,
        int availableQuantity
) {
}
