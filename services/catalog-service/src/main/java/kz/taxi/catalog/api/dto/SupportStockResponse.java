package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ProductStatus;

import java.time.Instant;
import java.util.List;

/**
 * The inventory of one offer, together with the holds that explain the counters.
 *
 * <p>Support almost never needs the raw stock row alone: {@code available} is the
 * difference between {@code onHand} and {@code reserved}, so the rows behind
 * {@code reserved} are part of the answer ("three units are held by two checkouts
 * that have not paid yet").
 */
public record SupportStockResponse(
        String productId,
        String merchantId,
        ProductStatus productStatus,
        boolean sellable,
        int onHand,
        int reserved,
        int available,
        Instant updatedAt,
        List<SupportReservationResponse> holds
) {
}
