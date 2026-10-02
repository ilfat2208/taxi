package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.MerchantStatus;

import java.time.Instant;

/** A merchant's own profile: the fuller view, only ever returned to its owner. */
public record MerchantResponse(
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
        Instant createdAt
) {
}
