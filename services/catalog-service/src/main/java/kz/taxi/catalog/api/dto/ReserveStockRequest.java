package kz.taxi.catalog.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * Reserve stock for a checkout.
 *
 * <p>{@code orderId} is the idempotency key of this call: a retried reservation
 * returns the stored one instead of holding the goods twice. It is required rather
 * than generated here, because the order service must be able to ask the same
 * question twice and get the same answer.
 *
 * <p>The quantity range (1..99) is enforced in the service, not with bean
 * validation, so that a bad quantity comes back as {@code INVALID_QUANTITY}
 * (a code the order service can switch on) rather than a generic validation error.
 */
public record ReserveStockRequest(
        @NotBlank @Size(max = 26) String orderId,
        @NotEmpty @Valid List<ReserveStockItemRequest> items
) {
}
