package kz.taxi.catalog.api.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** One line of a reservation request. */
public record ReserveStockItemRequest(
        @NotBlank @Size(max = 26) String productId,
        Integer quantity
) {
}
