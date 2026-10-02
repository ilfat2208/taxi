package kz.taxi.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * The editing buffer in front of a checkout.
 *
 * <p>A cart holds no money and reserves no stock: it is a mutable list of price
 * snapshots that the customer is still playing with. Everything that has to be
 * exact (availability, price, currency) is re-checked by the checkout saga, which
 * is why a stale snapshot here is an inconvenience and never a correctness
 * problem.
 *
 * <p>One user owns at most one {@code ACTIVE} cart at a time. That rule is
 * enforced by a partial unique index in the database
 * ({@code uq_cart_active_user}) rather than by a "select then insert" here,
 * because two concurrent requests both pass an application-level check.
 */
@Entity
@Table(name = "cart")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Cart {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "user_id", length = 64, nullable = false, updatable = false)
    private String userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private CartStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false)
    private Currency currency;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Opens an empty cart. {@code KZT} is the platform home currency. */
    public static Cart open(String userId, Currency currency) {
        Cart cart = new Cart();
        cart.id = Ulid.nextId();
        cart.userId = userId;
        cart.status = CartStatus.ACTIVE;
        cart.currency = currency == null ? Currency.KZT : currency;
        Instant now = Instant.now();
        cart.createdAt = now;
        cart.updatedAt = now;
        return cart;
    }

    // ------------------------------------------------------------------ queries

    public boolean isActive() {
        return status == CartStatus.ACTIVE;
    }

    public boolean isOwnedBy(String userId) {
        return this.userId != null && this.userId.equals(userId);
    }

    // ------------------------------------------------------------------ behaviour

    /** Consumes the cart: its lines now live in an order. */
    public void checkOut() {
        requireActive();
        this.status = CartStatus.CHECKED_OUT;
        touch();
    }

    /**
     * An empty cart follows the currency of its first line.
     *
     * <p>The column is {@code NOT NULL}, so a cart has to be created with some
     * currency before any product is known. Adopting the first product's currency
     * keeps that initial guess from making a dollar product unaddable.
     */
    public void adoptCurrency(Currency currency) {
        requireActive();
        if (currency != null && this.currency != currency) {
            this.currency = currency;
            touch();
        }
    }

    public void touch() {
        this.updatedAt = Instant.now();
    }

    private void requireActive() {
        if (!isActive()) {
            throw DomainException.conflict("cart {} is {} and can no longer be changed", id, status);
        }
    }
}
