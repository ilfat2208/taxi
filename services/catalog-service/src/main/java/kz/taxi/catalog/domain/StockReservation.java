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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One held quantity of one product for one checkout.
 *
 * <p>The row is the idempotency anchor of the internal reserve API: the table has
 * {@code UNIQUE (order_id, product_id)}, so a retried checkout cannot hold the
 * same goods twice even if it arrives on two nodes at once. All rows of an order
 * are created, committed and released together, which is why the response is
 * rebuilt from the whole row set and the state machine is per row.
 */
@Entity
@Table(name = "stock_reservation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StockReservation {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "product_id", length = 26, nullable = false, updatable = false)
    private String productId;

    @Column(name = "order_id", length = 26, nullable = false, updatable = false)
    private String orderId;

    @Column(name = "quantity", nullable = false)
    private int quantity;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private ReservationStatus status;

    /** When the expiry job may take the stock back; {@code null} means "never". */
    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    private StockReservation(String orderId, String productId, int quantity, Instant expiresAt) {
        this.id = Ulid.nextId();
        this.orderId = orderId;
        this.productId = productId;
        this.quantity = quantity;
        this.expiresAt = expiresAt;
        this.status = ReservationStatus.ACTIVE;
        Instant now = Instant.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    public static StockReservation hold(String orderId, String productId, int quantity, Instant expiresAt) {
        Preconditions.requireText(orderId, "orderId");
        Preconditions.requireText(productId, "productId");
        if (quantity <= 0) {
            throw new IllegalArgumentException("reservation quantity must be positive: " + quantity);
        }
        return new StockReservation(orderId, productId, quantity, expiresAt);
    }

    public boolean isActive() {
        return status.holdsStock();
    }

    public boolean isCommitted() {
        return status == ReservationStatus.COMMITTED;
    }

    public boolean isReleased() {
        return status == ReservationStatus.RELEASED;
    }

    public boolean isExpired() {
        return status == ReservationStatus.EXPIRED;
    }

    /** Payment succeeded: the goods are sold. */
    public void commit() {
        transitionTo(ReservationStatus.COMMITTED, "commit");
    }

    /** Checkout abandoned or payment failed: the goods go back on sale. */
    public void release() {
        transitionTo(ReservationStatus.RELEASED, "release");
    }

    /** Nothing paid in time; the stock was already handed back by the expiry job. */
    public void expire() {
        transitionTo(ReservationStatus.EXPIRED, "expire");
    }

    /**
     * Only an {@link ReservationStatus#ACTIVE} hold can move.
     *
     * <p>A commit of an expired reservation is the interesting case: the goods
     * have already been returned to the pool and may even be sold to somebody
     * else, so paying for them must fail loudly (409) rather than re-sell air.
     */
    private void transitionTo(ReservationStatus target, String operation) {
        if (status != ReservationStatus.ACTIVE) {
            throw DomainException.of(CatalogErrorCode.RESERVATION_NOT_ACTIVE,
                            "cannot {} reservation of order {}: it is already {}",
                            operation, orderId, status)
                    .withDetail("orderId", orderId)
                    .withDetail("productId", productId)
                    .withDetail("status", status.name());
        }
        status = target;
        updatedAt = Instant.now();
    }
}
