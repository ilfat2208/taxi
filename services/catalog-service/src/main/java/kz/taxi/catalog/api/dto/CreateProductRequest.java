package kz.taxi.catalog.api.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * A merchant publishing a new offer.
 *
 * <p>The price is a {@code long} in minor units together with an ISO code: the API
 * never accepts a decimal amount, which removes rounding from the wire format.
 */
public record CreateProductRequest(
        @NotBlank @Size(max = 64) String sku,
        @NotBlank @Size(max = 200) String title,
        String description,
        @NotBlank @Size(max = 64) String category,
        @Size(max = 120) String brand,
        @NotNull @Min(1) Long priceMinor,
        @NotBlank @Size(min = 3, max = 3) String currency,
        @Size(max = 512) String imageUrl,
        @Min(0) @Max(1_000_000) Integer initialStock
) {
}
