package kz.taxi.catalog.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.error.Preconditions;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Physical inventory of one product.
 *
 * <p>Two counters, one invariant: {@code reserved <= on_hand}, enforced both
 * here and by {@code ck_stock_reserved_le_on_hand}. Every mutation goes through
 * one of the four behaviour methods below so that the invariant cannot be
 * bypassed by a setter.
 *
 * <p>Rows are always read with a pessimistic write lock before they are mutated
 * (see {@code StockRepository}); this entity is the state, the lock is what makes
 * two simultaneous checkouts of the last unit safe.
 */
@Entity
@Table(name = "stock")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Stock {

    @Id
    @Column(name = "product_id", length = 26, nullable = false, updatable = false)
    private String productId;

    @Column(name = "on_hand", nullable = false)
    private int onHand;

    @Column(name = "reserved", nullable = false)
    private int reserved;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    private Stock(String productId, int onHand) {
        this.productId = productId;
        this.onHand = onHand;
        this.reserved = 0;
        this.updatedAt = Instant.now();
    }

    /** Creates the inventory row of a new offer. */
    public static Stock withOnHand(String productId, int onHand) {
        Preconditions.requireText(productId, "productId");
        if (onHand < 0) {
            throw new IllegalArgumentException("initial stock must not be negative: " + onHand);
        }
        return new Stock(productId, onHand);
    }

    public int available() {
        return onHand - reserved;
    }

    public Availability availability() {
        return new Availability(onHand, reserved);
    }

    /**
     * Holds {@code quantity} for a checkout.
     *
     * <p>The check is here, not in the caller: overselling is a domain rule, and
     * keeping it next to the counters means a new caller cannot forget it.
     */
    public void reserve(int quantity) {
        requirePositive(quantity);
        if (!availability().canFulfil(quantity)) {
            throw DomainException.of(CatalogErrorCode.INSUFFICIENT_STOCK,
                            "product {} has {} available but {} was requested",
                            productId, available(), quantity)
                    .withDetail("productId", productId)
                    .withDetail("available", available())
                    .withDetail("requested", quantity);
        }
        reserved += quantity;
        touch();
    }

    /** Paid: goods ship, so both the physical count and the promise drop. */
    public void commit(int quantity) {
        requirePositive(quantity);
        if (quantity > reserved) {
            throw notHeld(quantity, "commit");
        }
        onHand -= quantity;
        reserved -= quantity;
        touch();
    }

    /** Abandoned or expired: only the promise goes away, the goods stay. */
    public void release(int quantity) {
        requirePositive(quantity);
        if (quantity > reserved) {
            throw notHeld(quantity, "release");
        }
        reserved -= quantity;
        touch();
    }

    /**
     * Merchant restock (positive delta) or shrinkage (negative delta).
     *
     * <p>Two rejections, one code: on hand may never go negative and may never
     * fall below what is already promised to checkouts. Both are 422
     * {@code STOCK_ADJUSTMENT_INVALID} because from the merchant's point of view
     * it is the same mistake — "you cannot make this number smaller than that".
     */
    public void adjust(int delta) {
        if (delta == 0) {
            return;
        }
        int newOnHand = onHand + delta;
        if (newOnHand < 0) {
            throw DomainException.of(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID,
                            "adjusting product {} by {} would leave on hand at {}",
                            productId, delta, newOnHand)
                    .withDetail("productId", productId)
                    .withDetail("onHand", onHand)
                    .withDetail("reserved", reserved)
                    .withDetail("stockDelta", delta);
        }
        if (newOnHand < reserved) {
            throw DomainException.of(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID,
                            "adjusting product {} by {} would leave {} on hand but {} is reserved",
                            productId, delta, newOnHand, reserved)
                    .withDetail("productId", productId)
                    .withDetail("onHand", onHand)
                    .withDetail("reserved", reserved)
                    .withDetail("stockDelta", delta);
        }
        onHand = newOnHand;
        touch();
    }

    private static void requirePositive(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("quantity must be positive: " + quantity);
        }
    }

    private DomainException notHeld(int quantity, String operation) {
        // Only reachable if a reservation and its stock row disagree — the DB
        // CHECK constraint would reject the write anyway, this just names it.
        return DomainException.of(CatalogErrorCode.RESERVATION_NOT_ACTIVE,
                        "cannot {} {} of product {}: only {} is reserved",
                        operation, quantity, productId, reserved)
                .withDetail("productId", productId)
                .withDetail("reserved", reserved)
                .withDetail("requested", quantity);
    }

    private void touch() {
        updatedAt = Instant.now();
    }
}
