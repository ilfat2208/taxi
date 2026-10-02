package kz.taxi.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One purchased line, frozen at checkout time.
 *
 * <p>Prices, titles and the merchant are copied into the order rather than looked
 * up later: an order is a contract, and a merchant changing a price tomorrow must
 * not rewrite what a customer agreed to today. That is also why
 * {@code line_total_minor} is stored and CHECK-constrained against
 * {@code unit_price_minor * quantity} instead of being recomputed on read.
 */
@Entity
@Table(name = "order_item")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OrderItem {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "order_id", length = 26, nullable = false, updatable = false)
    private String orderId;

    @Column(name = "product_id", length = 26, nullable = false, updatable = false)
    private String productId;

    @Column(name = "merchant_id", length = 26, nullable = false, updatable = false)
    private String merchantId;

    @Column(name = "title", length = 200, nullable = false, updatable = false)
    private String title;

    @Column(name = "unit_price_minor", nullable = false, updatable = false)
    private long unitPriceMinor;

    @Column(name = "quantity", nullable = false, updatable = false)
    private int quantity;

    @Column(name = "line_total_minor", nullable = false, updatable = false)
    private long lineTotalMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    // ------------------------------------------------------------------ factories

    /** Copies a cart line into an order line; the cart may change, the order may not. */
    public static OrderItem fromCartItem(String orderId, CartItem item) {
        return of(orderId, item.getProductId(), item.getMerchantId(), item.getTitle(),
                item.getUnitPriceMinor(), item.getQuantity(), item.getCurrency());
    }

    public static OrderItem of(String orderId,
                               String productId,
                               String merchantId,
                               String title,
                               long unitPriceMinor,
                               int quantity,
                               Currency currency) {
        OrderItem item = new OrderItem();
        item.id = Ulid.nextId();
        item.orderId = orderId;
        item.productId = productId;
        item.merchantId = merchantId;
        item.title = title;
        item.unitPriceMinor = unitPriceMinor;
        item.quantity = quantity;
        item.lineTotalMinor = Math.multiplyExact(unitPriceMinor, quantity);
        item.currency = currency;
        return item;
    }

    public Money lineTotal() {
        return Money.ofMinor(lineTotalMinor, currency);
    }
}
