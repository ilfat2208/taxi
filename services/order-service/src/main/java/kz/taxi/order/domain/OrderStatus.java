package kz.taxi.order.domain;

import java.util.Set;

/**
 * Order state machine — the single place where "may this order move there?" is decided.
 *
 * <pre>
 *   DRAFT ──► PENDING_PAYMENT ──► PAID ──► CONFIRMED
 *                                 │
 *              ┌──────────────────┴───────────────┐
 *              ▼                                  ▼
 *          CANCELLED                            FAILED
 * </pre>
 *
 * <p>Rules that matter for money:
 * <ul>
 *   <li>{@code PAID} is <em>not</em> reachable from {@code CANCELLED} or
 *       {@code FAILED}: a late {@code payment.completed} event must never
 *       resurrect an order whose stock has already been released.</li>
 *   <li>{@code CANCELLED} is not reachable from {@code PAID}: money has moved, so
 *       the only legal way out of {@code PAID} is {@code CONFIRMED} (a refund is a
 *       separate compensating payment, not an order status).</li>
 *   <li>{@code CONFIRMED} is declared here because the database CHECK constraint
 *       allows it; nothing in the checkout saga produces it yet — it is the state a
 *       delivery step will move an order into.</li>
 * </ul>
 */
public enum OrderStatus {

    DRAFT,
    PENDING_PAYMENT,
    /** Money is captured. Stock still has to be committed before the order is complete. */
    PAID,
    CONFIRMED,
    CANCELLED,
    FAILED;

    /**
     * Where this status may go next.
     *
     * <p>A {@code switch} rather than a constructor argument: an enum constant cannot
     * legally reference the constants declared after it, and a table that lists the
     * transitions next to the statuses is what a reader wants anyway.
     */
    public Set<OrderStatus> allowedTargets() {
        return switch (this) {
            case DRAFT -> Set.of(PENDING_PAYMENT, CANCELLED, FAILED);
            case PENDING_PAYMENT -> Set.of(PAID, CANCELLED, FAILED);
            case PAID -> Set.of(CONFIRMED);
            case CONFIRMED, CANCELLED, FAILED -> Set.of();
        };
    }

    public boolean canTransitionTo(OrderStatus target) {
        return target != null && allowedTargets().contains(target);
    }

    /** True when no further saga step can change this order. */
    public boolean isFinal() {
        return allowedTargets().isEmpty();
    }
}
