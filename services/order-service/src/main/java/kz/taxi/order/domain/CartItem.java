package kz.taxi.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One line of a cart: a product with the price the catalog quoted when it was added.
 *
 * <p>The snapshot ({@code title}, {@code imageUrl}, {@code unitPriceMinor},
 * {@code merchantId}, {@code currency}) is refreshed every time the same product
 * is added again. Without a snapshot the cart page would need one catalog call per
 * line — and a catalog outage would empty a customer's cart, which is exactly what
 * the cart must survive.
 *
 * <p>The quantity range (1..99) is a business rule, expressed as
 * {@link OrderErrorCode#INVALID_QUANTITY} rather than as a bean-validation
 * message, so the client can react to it programmatically.
 */
@Entity
@Table(name = "cart_item")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CartItem {

    public static final int MIN_QUANTITY = 1;
    public static final int MAX_QUANTITY = 99;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "cart_id", length = 26, nullable = false, updatable = false)
    private String cartId;

    @Column(name = "product_id", length = 26, nullable = false, updatable = false)
    private String productId;

    @Column(name = "merchant_id", length = 26, nullable = false)
    private String merchantId;

    @Column(name = "title", length = 200, nullable = false)
    private String title;

    @Column(name = "image_url", length = 512)
    private String imageUrl;

    @Column(name = "unit_price_minor", nullable = false)
    private long unitPriceMinor;

    @Column(name = "quantity", nullable = false)
    private int quantity;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false)
    private Currency currency;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    // NOTE: deliberately no @Version here. The frozen V1 schema has no `version`
    // column on cart_item (only `cart` and `customer_order` are optimistically
    // locked), and Hibernate's ddl-auto=validate refuses to start otherwise.
    // Contention on a single customer's cart lines is low, and the cart row that
    // owns them is locked anyway.

    // ------------------------------------------------------------------ factories

    public static CartItem of(String cartId,
                              String productId,
                              ProductSnapshot product,
                              int quantity) {
        validateQuantity(quantity);
        CartItem item = new CartItem();
        item.id = Ulid.nextId();
        item.cartId = cartId;
        item.productId = productId;
        item.quantity = quantity;
        Instant now = Instant.now();
        item.createdAt = now;
        item.updatedAt = now;
        item.applySnapshot(product);
        return item;
    }

    // ------------------------------------------------------------------ behaviour

    /** Re-reads the catalog facts and adds the requested quantity to this line. */
    public void mergeWith(ProductSnapshot product, int additionalQuantity) {
        validateQuantity(Math.addExact(quantity, additionalQuantity));
        applySnapshot(product);
        this.quantity = Math.addExact(quantity, additionalQuantity);
        touch();
    }

    public void changeQuantity(int newQuantity) {
        validateQuantity(newQuantity);
        this.quantity = newQuantity;
        touch();
    }

    public Money lineTotal() {
        return Money.ofMinor(lineTotalMinor(), currency);
    }

    public long lineTotalMinor() {
        return Math.multiplyExact(unitPriceMinor, quantity);
    }

    public boolean isInCart(String cartId) {
        return this.cartId != null && this.cartId.equals(cartId);
    }

    /** True when the line was quoted in another currency than the cart is kept in. */
    public boolean isQuotedIn(Currency other) {
        return other != null && currency != other;
    }

    // ------------------------------------------------------------------ internals

    private void applySnapshot(ProductSnapshot product) {
        this.merchantId = product.merchantId();
        this.title = product.title();
        this.imageUrl = product.imageUrl();
        this.unitPriceMinor = product.unitPriceMinor();
        this.currency = product.currency();
    }

    private void touch() {
        this.updatedAt = Instant.now();
    }

    /**
     * Enforces the 1..99 quantity rule.
     *
     * <p>Public so the application layer can reject a bad request before calling
     * the catalog: a quantity of 0 is a client mistake, and answering it with a
     * downstream call would be a wasted round trip.
     */
    public static void validateQuantity(int quantity) {
        if (quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
            throw DomainException.of(OrderErrorCode.INVALID_QUANTITY,
                            "quantity must be between {} and {} but was {}", MIN_QUANTITY, MAX_QUANTITY, quantity)
                    .withDetail("minQuantity", MIN_QUANTITY)
                    .withDetail("maxQuantity", MAX_QUANTITY)
                    .withDetail("quantity", quantity);
        }
    }
}
