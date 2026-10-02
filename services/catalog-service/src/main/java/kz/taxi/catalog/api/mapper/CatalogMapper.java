package kz.taxi.catalog.api.mapper;

import kz.taxi.catalog.api.dto.InternalProductResponse;
import kz.taxi.catalog.api.dto.MerchantResponse;
import kz.taxi.catalog.api.dto.MerchantSummaryResponse;
import kz.taxi.catalog.api.dto.ProductDetailResponse;
import kz.taxi.catalog.api.dto.ProductSummaryResponse;
import kz.taxi.catalog.domain.Availability;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.infrastructure.ProductSearchRow;

/**
 * Entity/projection -> DTO translation.
 *
 * <p>Static and dependency-free so the mapping is trivially testable and cannot
 * grow a database call: a mapper that loads entities on demand is how N+1 queries
 * sneak into a list endpoint.
 */
public final class CatalogMapper {

    private CatalogMapper() {
    }

    public static ProductSummaryResponse toSummary(ProductSearchRow row) {
        return new ProductSummaryResponse(
                row.id(),
                row.merchantId(),
                row.merchantName(),
                row.title(),
                row.description(),
                row.category(),
                row.brand(),
                row.priceMinor(),
                row.currency(),
                row.imageUrl(),
                kz.taxi.catalog.domain.ProductStatus.valueOf(row.status()),
                row.availableQuantity());
    }

    public static ProductDetailResponse toDetail(Product product, Merchant merchant, Availability availability) {
        return new ProductDetailResponse(
                product.getId(),
                product.getMerchantId(),
                merchant.publicName(),
                product.getTitle(),
                product.getDescription(),
                product.getCategory(),
                product.getBrand(),
                product.getPriceMinor(),
                product.getCurrency().name(),
                product.getImageUrl(),
                product.getStatus(),
                availability.available(),
                toMerchantSummary(merchant),
                availability.onHand(),
                availability.reserved(),
                availability.available());
    }

    public static MerchantResponse toMerchant(Merchant merchant) {
        return new MerchantResponse(
                merchant.getId(),
                merchant.getOwnerUserId(),
                merchant.getName(),
                merchant.getDisplayName(),
                merchant.getPhone(),
                merchant.getEmail(),
                merchant.getCity(),
                merchant.getStatus(),
                merchant.getRatingBasisPoints(),
                merchant.payoutAccountId(),
                merchant.getCreatedAt());
    }

    public static MerchantSummaryResponse toMerchantSummary(Merchant merchant) {
        return new MerchantSummaryResponse(
                merchant.getId(),
                merchant.getName(),
                merchant.publicName(),
                merchant.getCity(),
                merchant.getStatus(),
                merchant.getRatingBasisPoints());
    }

    public static InternalProductResponse toInternalProduct(Product product, Availability availability) {
        return new InternalProductResponse(
                product.getId(),
                product.getMerchantId(),
                product.getTitle(),
                product.getPriceMinor(),
                product.getCurrency().name(),
                product.getStatus(),
                availability.available());
    }
}
