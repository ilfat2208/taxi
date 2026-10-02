package kz.taxi.catalog.api.dto;

import jakarta.validation.constraints.Size;

/**
 * Why a checkout gave the goods back.
 *
 * <p>Optional: the stock movement is the same whether the cart was abandoned or
 * the payment failed, but the reason travels in the {@code stock.released} event
 * so that consumers counting lost sales can tell the two apart.
 */
public record ReleaseReservationRequest(
        @Size(max = 200) String reason
) {
}
