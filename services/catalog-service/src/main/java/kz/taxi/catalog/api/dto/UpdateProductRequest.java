package kz.taxi.catalog.api.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import kz.taxi.catalog.domain.ProductStatus;

/**
 * Partial update of an offer: every field is optional, {@code null} means "leave
 * it as it is".
 *
 * <p>{@code stockDelta} is a delta, not a new absolute value, on purpose: two
 * merchants' assistants adjusting the same product from two devices must add up
 * instead of overwriting each other. {@code stockReason} is the merchant's own
 * note ("restock", "damaged in warehouse") and is recorded in the log line of the
 * adjustment, since the frozen schema has no stock-movement table to store it in.
 *
 * <p>Publishing is expressed as {@code status=ACTIVE}, which is what emits
 * {@code product.published}.
 */
public record UpdateProductRequest(
        @Size(min = 1, max = 200) String title,
        String description,
        @Size(min = 1, max = 64) String category,
        @Size(max = 120) String brand,
        @Min(1) Long priceMinor,
        ProductStatus status,
        Integer stockDelta,
        @Size(max = 200) String stockReason
) {
}
