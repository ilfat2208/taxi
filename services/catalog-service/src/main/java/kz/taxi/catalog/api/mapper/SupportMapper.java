package kz.taxi.catalog.api.mapper;

import kz.taxi.catalog.api.dto.SupportAuditRecordResponse;
import kz.taxi.catalog.api.dto.SupportMerchantResponse;
import kz.taxi.catalog.api.dto.SupportProductResponse;
import kz.taxi.catalog.api.dto.SupportReservationResponse;
import kz.taxi.catalog.api.dto.SupportStockResponse;
import kz.taxi.catalog.domain.Availability;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductStatus;
import kz.taxi.catalog.domain.StockReservation;
import kz.taxi.catalog.domain.SupportAuditRecord;

import java.util.List;

/**
 * Entity -> support DTO translation.
 *
 * <p>Static and dependency-free like {@link CatalogMapper}, for the same reason:
 * support reads must not be able to trigger a query per row.
 *
 * <p>The interesting decision here is {@link #unavailableReason}: the two facts that
 * block a purchase (a status that cannot be sold, and no available stock) are
 * combined into one sentence, because the agent on the phone needs the answer, not
 * the raw material to derive it.
 */
public final class SupportMapper {

    private SupportMapper() {
    }

    public static SupportMerchantResponse toSupportMerchant(Merchant merchant, long productCount) {
        return new SupportMerchantResponse(
                merchant.getId(),
                merchant.getOwnerUserId(),
                merchant.getName(),
                merchant.publicName(),
                merchant.getPhone(),
                merchant.getEmail(),
                merchant.getCity(),
                merchant.getStatus(),
                merchant.getRatingBasisPoints(),
                merchant.payoutAccountId(),
                productCount,
                merchant.getCreatedAt());
    }

    public static SupportProductResponse toSupportProduct(Product product,
                                                          String merchantName,
                                                          Availability availability) {
        boolean sellable = product.isSellable();
        boolean buyable = sellable && availability.available() > 0;
        return new SupportProductResponse(
                product.getId(),
                product.getMerchantId(),
                merchantName,
                product.getSku(),
                product.getTitle(),
                product.getCategory(),
                product.getBrand(),
                product.getStatus(),
                sellable,
                product.isArchived(),
                buyable,
                buyable ? null : unavailableReason(product.getStatus(), availability),
                product.getPriceMinor(),
                product.getCurrency().name(),
                availability.onHand(),
                availability.reserved(),
                availability.available());
    }

    /**
     * The one sentence that answers "why can this customer not buy it?".
     *
     * <p>Order matters: an offer that is not for sale at all (draft, archived) is
     * stated as such even when stock exists, because that is the blocker the customer
     * is hitting; only then is stock the reason.
     */
    public static String unavailableReason(ProductStatus status, Availability availability) {
        return switch (status) {
            case DRAFT -> "offer is DRAFT: the merchant has not published it yet";
            case ARCHIVED -> "offer is ARCHIVED: it was withdrawn from the catalog";
            case OUT_OF_STOCK -> availability.available() > 0
                    ? "offer is marked OUT_OF_STOCK by the merchant although %d unit(s) are available"
                            .formatted(availability.available())
                    : "offer is marked OUT_OF_STOCK by the merchant";
            case ACTIVE -> "nothing available: %d on hand, %d held by other checkouts"
                    .formatted(availability.onHand(), availability.reserved());
        };
    }

    public static SupportStockResponse toSupportStock(Product product,
                                                      Availability availability,
                                                      List<StockReservation> holds) {
        return new SupportStockResponse(
                product.getId(),
                product.getMerchantId(),
                product.getStatus(),
                product.isSellable(),
                availability.onHand(),
                availability.reserved(),
                availability.available(),
                product.getUpdatedAt(),
                holds.stream().map(SupportMapper::toSupportReservation).toList());
    }

    public static SupportReservationResponse toSupportReservation(StockReservation reservation) {
        return new SupportReservationResponse(
                reservation.getId(),
                reservation.getOrderId(),
                reservation.getProductId(),
                reservation.getQuantity(),
                reservation.getStatus(),
                reservation.getExpiresAt(),
                reservation.getCreatedAt());
    }

    public static SupportAuditRecordResponse toAuditRecord(SupportAuditRecord record) {
        return new SupportAuditRecordResponse(
                record.getId(),
                record.getActorUserId(),
                record.getAction(),
                record.getEndpoint(),
                record.getResourceType(),
                record.getResourceId(),
                record.getCorrelationId(),
                record.getCreatedAt());
    }
}
