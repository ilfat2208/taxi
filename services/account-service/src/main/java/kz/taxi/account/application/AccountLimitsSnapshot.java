package kz.taxi.account.application;

import kz.taxi.account.domain.LimitWindow;
import kz.taxi.common.core.money.Currency;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * What an operator sees on the limits screen: the configured ceiling, what has
 * already been committed against it, and when the window resets.
 *
 * <p>Deliberately not an entity view: a client asking "can this payment go
 * through?" needs the same three numbers the enforcement path uses, so both come
 * from one place and cannot drift apart.
 */
public record AccountLimitsSnapshot(String accountId,
                                    Currency currency,
                                    List<WindowLimit> limits,
                                    Velocity velocity) {

    /**
     * One window of one account.
     *
     * @param configured            false when no limit row exists, i.e. unlimited
     * @param outgoingLimitMinor    null when unlimited
     * @param remainingMinor        null when unlimited; never negative
     * @param updatedAt             null when unlimited
     */
    public record WindowLimit(LimitWindow window,
                              boolean configured,
                              Long outgoingLimitMinor,
                              long usedMinor,
                              Long remainingMinor,
                              Instant windowStart,
                              Instant windowEnd,
                              Instant updatedAt) {
    }

    /**
     * The velocity control as configured, plus what the account has used of it.
     *
     * @param enabled           false when {@code taxi.account.velocity.max-operations <= 0}
     * @param operationsInWindow outgoing operations started inside the window
     */
    public record Velocity(boolean enabled,
                           int maxOperations,
                           Duration window,
                           long operationsInWindow) {
    }
}
