package kz.taxi.catalog.api.dto;

/**
 * What the settlement side needs to know about a merchant.
 *
 * <p>Deliberately narrow: an id to group settlements by, the owner (so the debt can
 * be attributed and authorized), the name for statements, and the payout account.
 * Contact details and ratings have no business in a payout decision.
 */
public record InternalMerchantResponse(
        String merchantId,
        String ownerUserId,
        String displayName,
        String status,
        String payoutAccountId
) {

    public boolean hasPayoutAccount() {
        return payoutAccountId != null && !payoutAccountId.isBlank();
    }
}
