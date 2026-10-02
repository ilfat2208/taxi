package kz.taxi.payment.domain;

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
 * Append-only audit row of the state machine.
 *
 * <p>Two things are written here, and both are needed to explain a payment after
 * the fact:
 * <ul>
 *   <li>the status moves ({@code INITIATED -> PENDING -> COMPLETED}), so a dispute
 *       can be answered with "who moved it and when";</li>
 *   <li>the recovery job's attempts ({@code from_status == to_status}, actor
 *       {@code recovery}), which is also the counter that stops a payment stuck
 *       forever from being retried forever.</li>
 * </ul>
 *
 * <p>Rows are never updated or deleted: the table is the service's memory of its
 * own decisions.
 */
@Entity
@Table(name = "payment_transition")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PaymentTransition {

    /** The user-facing request that drove the payment. */
    public static final String ACTOR_API = "api";

    /** The saga's own steps: reserving, capturing, compensating. */
    public static final String ACTOR_SAGA = "saga";

    /** The scheduled recovery job. */
    public static final String ACTOR_RECOVERY = "recovery";

    /** A refund that reversed the payment. */
    public static final String ACTOR_REFUND = "refund";

    private static final int REASON_LENGTH = 512;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "payment_id", length = 26, nullable = false, updatable = false)
    private String paymentId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", length = 16)
    private PaymentStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", length = 16, nullable = false)
    private PaymentStatus toStatus;

    @Column(name = "reason", length = REASON_LENGTH)
    private String reason;

    @Column(name = "actor", length = 64)
    private String actor;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public static PaymentTransition of(String paymentId,
                                       PaymentStatus fromStatus,
                                       PaymentStatus toStatus,
                                       String reason,
                                       String actor) {
        PaymentTransition transition = new PaymentTransition();
        transition.id = Ulid.nextId();
        transition.paymentId = paymentId;
        transition.fromStatus = fromStatus;
        transition.toStatus = toStatus;
        transition.reason = reason == null || reason.length() <= REASON_LENGTH
                ? reason
                : reason.substring(0, REASON_LENGTH);
        transition.actor = actor;
        transition.createdAt = Instant.now();
        return transition;
    }

    public boolean isStatusChange() {
        return fromStatus != toStatus;
    }
}
