package kz.taxi.account.domain;

/**
 * Lifecycle of a hold (reserved funds).
 *
 * <pre>
 *   ACTIVE --capture--> CAPTURED   (money moved)
 *          --release--> RELEASED   (payment failed or was cancelled)
 *          --expire --> EXPIRED    (payment never finished)
 * </pre>
 *
 * <p>Only ACTIVE is actionable. Everything else is terminal, which is what makes
 * capture/release safely idempotent: a repeat call sees a terminal state and
 * returns it instead of moving money again.
 */
public enum HoldStatus {

    ACTIVE,
    CAPTURED,
    RELEASED,
    EXPIRED;

    public boolean isTerminal() {
        return this != ACTIVE;
    }
}
