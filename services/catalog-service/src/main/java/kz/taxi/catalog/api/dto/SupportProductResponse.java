package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ProductStatus;

/**
 * An offer as support sees it, drafts and archived offers included.
 *
 * <p>This is the "why can this customer not buy?" answer, so it carries the two
 * facts the public card does not pair up: the <strong>status</strong> (a draft is
 * invisible to shoppers even though the merchant sees it) and the
 * <strong>availability triple</strong> (on hand, reserved, available). The verdict
 * is spelled out in {@code buyable} with {@code unavailableReason} naming the one
 * blocker, so an agent does not have to know to combine the two.
 *
 * @param sellable          whether the status may be ordered at all (a DRAFT or
 *                          ARCHIVED offer is not sellable no matter the stock)
 * @param buyable           {@code sellable && available > 0} — the single boolean
 *                          that answers the customer's question
 * @param unavailableReason {@code null} when buyable, otherwise the blocker
 */
public record SupportProductResponse(
        String id,
        String merchantId,
        String merchantName,
        String sku,
        String title,
        String category,
        String brand,
        ProductStatus status,
        boolean sellable,
        boolean archived,
        boolean buyable,
        String unavailableReason,
        long priceMinor,
        String currency,
        int onHand,
        int reserved,
        int available
) {
}
