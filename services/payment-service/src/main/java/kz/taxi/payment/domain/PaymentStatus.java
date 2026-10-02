package kz.taxi.payment.domain;

import java.util.Map;
import java.util.Set;

/**
 * Lifecycle of a payment.
 *
 * <pre>
 *   INITIATED --&gt; PENDING --&gt; COMPLETED --&gt; REVERSED
 *                          --&gt; FAILED
 * </pre>
 *
 * <p>The three states carry very different meanings for the money, and that is
 * why they are distinct rather than a boolean "done":
 * <ul>
 *   <li>{@code INITIATED} — the saga exists and is addressable by its id, but no
 *       remote call has been made yet. Failing from here costs nothing.</li>
 *   <li>{@code PENDING} — the hold has been (or is about to be) requested, so
 *       funds may be reserved right now. Only the account service knows the
 *       truth, which is what makes this state the one the recovery job exists
 *       for.</li>
 *   <li>{@code COMPLETED} / {@code FAILED} — terminal: money moved, or the
 *       payment is closed and any reservation must have been given back.</li>
 *   <li>{@code REVERSED} — a completed payment that was refunded in full. It stays
 *       distinguishable from {@code COMPLETED} on purpose: reporting and
 *       reconciliation must see the reversal, not lose it in a refund table.</li>
 * </ul>
 *
 * <p>The allowed edges are data, not scattered {@code if}s: one table answers
 * "is this move legal", and both the entity and its tests read that same table.
 */
public enum PaymentStatus {

    INITIATED, PENDING, COMPLETED, FAILED, REVERSED;

    private static final Map<PaymentStatus, Set<PaymentStatus>> ALLOWED = Map.of(
            INITIATED, Set.of(PENDING, FAILED),
            PENDING, Set.of(COMPLETED, FAILED),
            COMPLETED, Set.of(REVERSED),
            FAILED, Set.of(),
            REVERSED, Set.of());

    /** True when this state may move to {@code target} in one step. */
    public boolean canTransitionTo(PaymentStatus target) {
        return target != null && ALLOWED.getOrDefault(this, Set.of()).contains(target);
    }

    /** No further transition is allowed: the payment is closed. */
    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED || this == REVERSED;
    }

    /** Money has moved and the payment was not rejected: completed or reversed. */
    public boolean isSettled() {
        return this == COMPLETED || this == REVERSED;
    }
}
