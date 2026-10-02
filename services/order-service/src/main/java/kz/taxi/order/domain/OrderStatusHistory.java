package kz.taxi.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One step of the order's saga, appended in the same transaction as the change it
 * describes.
 *
 * <p>Support, the customer and the recovery job all ask the same question — "why is
 * this order in this state?" — and the answer has to survive log rotation. The
 * {@code actor} column separates a customer action from the payment service's
 * answer and from the recovery job's intervention, which is the first thing to
 * look at when an order looks wrong.
 */
@Entity
@Table(name = "order_status_history")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OrderStatusHistory {

    /** Actor recorded for transitions the customer caused. */
    public static final String ACTOR_CUSTOMER = "customer";
    /** Actor recorded for transitions a remote answer caused. */
    public static final String ACTOR_PAYMENT_SERVICE = "payment-service";
    /** Actor recorded for transitions the scheduled recovery job caused. */
    public static final String ACTOR_RECOVERY_JOB = "recovery-job";
    /** Actor recorded for transitions the payment event stream caused. */
    public static final String ACTOR_PAYMENT_EVENT = "payment-event";

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "order_id", length = 26, nullable = false, updatable = false)
    private String orderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", length = 24)
    private OrderStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", length = 24, nullable = false)
    private OrderStatus toStatus;

    @Column(name = "reason", length = 512)
    private String reason;

    @Column(name = "actor", length = 64)
    private String actor;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public static OrderStatusHistory of(String orderId,
                                        OrderStatus fromStatus,
                                        OrderStatus toStatus,
                                        String reason,
                                        String actor) {
        OrderStatusHistory history = new OrderStatusHistory();
        history.id = Ulid.nextId();
        history.orderId = orderId;
        history.fromStatus = fromStatus;
        history.toStatus = toStatus;
        history.reason = reason == null || reason.length() <= 512 ? reason : reason.substring(0, 512);
        history.actor = actor;
        history.createdAt = Instant.now();
        return history;
    }
}
