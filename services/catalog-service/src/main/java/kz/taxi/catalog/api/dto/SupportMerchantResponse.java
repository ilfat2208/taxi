package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.MerchantStatus;

import java.time.Instant;

/**
 * The support view of a seller.
 *
 * <p>Deliberately larger than {@link MerchantSummaryResponse}: support exists to
 * resolve a complaint, so it gets the owner user id (to join a caller to a shop),
 * the contact details and the payout account the public summary hides. That
 * difference is exactly why reading it is audited.
 */
public record SupportMerchantResponse(
        String id,
        String ownerUserId,
        String name,
        String displayName,
        String phone,
        String email,
        String city,
        MerchantStatus status,
        int ratingBasisPoints,
        String payoutAccountId,
        long productCount,
        Instant createdAt
) {
}
