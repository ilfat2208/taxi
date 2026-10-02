package kz.taxi.catalog.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.error.Preconditions;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * An offer: one merchant's sellable item.
 *
 * <p>Price is stored in minor units as a {@code long} next to its currency, so
 * no rounding ever happens on the read path. The generated {@code search_vector}
 * column of the table is intentionally <em>not</em> mapped: Postgres maintains it
 * from title/brand/category/description, and mapping it would let Hibernate try
 * to write a value it does not own.
 */
@Entity
@Table(name = "product")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Product {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "merchant_id", length = 26, nullable = false, updatable = false)
    private String merchantId;

    @Column(name = "sku", length = 64, nullable = false)
    private String sku;

    @Column(name = "title", length = 200, nullable = false)
    private String title;

    @Column(name = "description")
    private String description;

    @Column(name = "category", length = 64, nullable = false)
    private String category;

    @Column(name = "brand", length = 120)
    private String brand;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false)
    private Currency currency;

    @Column(name = "price_minor", nullable = false)
    private long priceMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private ProductStatus status;

    /** Free-form merchant attributes; kept as JSON text because nothing queries it yet. */
    @Column(name = "attributes")
    private String attributes;

    @Column(name = "image_url", length = 512)
    private String imageUrl;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    /**
     * Publishes a new offer.
     *
     * <p>Created {@link ProductStatus#ACTIVE}: a marketplace offer only exists to
     * be sold, and the merchant can move it to {@code DRAFT} with a PATCH if it
     * needs more work. {@code DRAFT} is available as an explicit merchant action,
     * not as a hidden default that makes a fresh product invisible in search.
     */
    public static Product publish(String merchantId, String sku, String title, String description,
                                  String category, String brand, Currency currency,
                                  long priceMinor, String imageUrl) {
        Preconditions.requireText(merchantId, "merchantId");
        Preconditions.requireText(sku, "sku");
        Preconditions.requireText(title, "title");
        Preconditions.requireText(category, "category");
        if (currency == null) {
            throw new IllegalArgumentException("currency must not be null");
        }
        if (priceMinor <= 0) {
            throw new IllegalArgumentException("priceMinor must be positive: " + priceMinor);
        }
        Product product = new Product();
        product.id = Ulid.nextId();
        product.merchantId = merchantId;
        product.sku = sku.trim();
        product.title = title.trim();
        product.description = description;
        product.category = category.trim();
        product.brand = brand;
        product.currency = currency;
        product.priceMinor = priceMinor;
        product.imageUrl = imageUrl;
        product.status = ProductStatus.ACTIVE;
        Instant now = Instant.now();
        product.createdAt = now;
        product.updatedAt = now;
        return product;
    }

    /** Partial update: {@code null} means "leave as it is" for every field. */
    public void updateDetails(String newTitle, String newDescription, String newCategory, String newBrand) {
        if (newTitle != null) {
            Preconditions.requireText(newTitle, "title");
            title = newTitle.trim();
        }
        if (newDescription != null) {
            description = newDescription;
        }
        if (newCategory != null) {
            Preconditions.requireText(newCategory, "category");
            category = newCategory.trim();
        }
        if (newBrand != null) {
            brand = newBrand.isBlank() ? null : newBrand.trim();
        }
        touch();
    }

    public void changePrice(long newPriceMinor) {
        if (newPriceMinor <= 0) {
            throw new IllegalArgumentException("priceMinor must be positive: " + newPriceMinor);
        }
        priceMinor = newPriceMinor;
        touch();
    }

    public void changeStatus(ProductStatus newStatus) {
        if (newStatus == null || newStatus == status) {
            return;
        }
        status = newStatus;
        touch();
    }

    public boolean isArchived() {
        return status == ProductStatus.ARCHIVED;
    }

    /** Whether a checkout may hold stock for this offer. */
    public boolean isSellable() {
        return status.sellable();
    }

    /**
     * Guards the checkout path: a draft or archived offer is a conflict, not a
     * missing product — the caller sent a real id, the offer is just not for sale.
     */
    public void requireSellable() {
        if (!isSellable()) {
            throw DomainException.of(CatalogErrorCode.PRODUCT_NOT_AVAILABLE,
                    "product {} is {} and cannot be ordered", id, status)
                    .withDetail("productId", id)
                    .withDetail("status", status.name());
        }
    }

    private void touch() {
        updatedAt = Instant.now();
    }
}
