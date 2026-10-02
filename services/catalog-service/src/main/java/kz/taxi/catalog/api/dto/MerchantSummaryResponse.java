package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.MerchantStatus;

/**
 * Public face of a seller: what a shopper sees on a product card.
 *
 * <p>Contact details and the owner's user id are excluded — a product page has no
 * business exposing another user's identity or phone number.
 */
public record MerchantSummaryResponse(
        String id,
        String name,
        String displayName,
        String city,
        MerchantStatus status,
        int ratingBasisPoints
) {
}
