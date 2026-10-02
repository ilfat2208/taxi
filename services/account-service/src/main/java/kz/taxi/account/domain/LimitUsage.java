package kz.taxi.account.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * What an account has already committed inside one window bucket.
 *
 * <p>Kept as a counter rather than derived from the ledger on every request — the
 * reasoning and the accepted risk are documented on the table itself in
 * {@code V2__account_limits.sql}. The short version: the enforcement query runs
 * on the hot path while the account row is locked, and this counter cannot drift
 * because every mutation shares the transaction and the row lock with the hold it
 * describes.
 *
 * <p>Rule for what counts (and what stops counting):
 * <ul>
 *   <li>placing a hold adds its amount — the money is spoken for;</li>
 *   <li>capturing changes nothing — the hold was already counted, so the limit is
 *       never charged twice for one payment;</li>
 *   <li>releasing or expiring subtracts it, which is what makes a limit a limit
 *       rather than a slow leak: a customer whose payment failed can immediately
 *       try again;</li>
 *   <li>a hold that crosses a window boundary is counted in the window it was
 *       placed in, because that is when the money was committed.</li>
 * </ul>
 */
@Entity
@Table(name = "limit_usage")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LimitUsage {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "account_id", length = 26, nullable = false, updatable = false)
    private String accountId;

    /** Quoted because {@code window} is a reserved word in PostgreSQL. */
    @Enumerated(EnumType.STRING)
    @Column(name = "\"window\"", length = 16, nullable = false, updatable = false)
    private LimitWindow window;

    @Column(name = "window_start", nullable = false, updatable = false)
    private Instant windowStart;

    @Column(name = "used_minor", nullable = false)
    private long usedMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    // ------------------------------------------------------------------ factories

    public static LimitUsage opening(String accountId, LimitWindow window, Instant windowStart, Currency currency) {
        LimitUsage usage = new LimitUsage();
        usage.id = Ulid.nextId();
        usage.accountId = accountId;
        usage.window = window;
        usage.windowStart = windowStart;
        usage.usedMinor = 0L;
        usage.currency = currency;
        Instant now = Instant.now();
        usage.createdAt = now;
        usage.updatedAt = now;
        return usage;
    }

    // ------------------------------------------------------------------ behaviour

    /** Reserves limit budget; called in the same transaction as the hold. */
    public void add(long amountMinor) {
        requirePositive(amountMinor);
        this.usedMinor = Math.addExact(this.usedMinor, amountMinor);
        touch();
    }

    /**
     * Gives limit budget back when a hold is released or expires.
     *
     * <p>Floored at zero instead of throwing: this is a control figure, not the
     * ledger, and a double release must not be able to push it negative — a
     * negative "already spent" would silently widen the customer's limit, which is
     * the one direction of error that costs money.
     */
    public void subtract(long amountMinor) {
        requirePositive(amountMinor);
        this.usedMinor = Math.max(0L, this.usedMinor - amountMinor);
        touch();
    }

    // ------------------------------------------------------------------ internals

    private static void requirePositive(long amountMinor) {
        if (amountMinor <= 0) {
            throw DomainException.of(AccountErrorCode.INVALID_AMOUNT, "amount must be positive but was {}", amountMinor);
        }
    }

    private void touch() {
        this.updatedAt = Instant.now();
    }
}
