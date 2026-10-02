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
 * An outgoing limit configured for one account and one window.
 *
 * <p>A missing row means "no limit configured", which is interpreted as
 * unlimited. That default is a deliberate migration and operations decision (see
 * {@code V2__account_limits.sql}): refusing payments for every account that has no
 * row would turn a deployment into an outage. A real deployment seeds defaults.
 *
 * <p>The limit caps <em>committed outgoing value</em>, i.e. the sum of holds the
 * account has placed in the window, whether they are still active or already
 * captured. It is checked on the hold path, because that is the moment money
 * becomes unavailable to the customer: enforcing at capture would let an attacker
 * queue unlimited payments and only discover the refusal after the goods shipped.
 */
@Entity
@Table(name = "account_limit")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AccountLimit {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "account_id", length = 26, nullable = false, updatable = false)
    private String accountId;

    /** Quoted because {@code window} is a reserved word in PostgreSQL. */
    @Enumerated(EnumType.STRING)
    @Column(name = "\"window\"", length = 16, nullable = false, updatable = false)
    private LimitWindow window;

    @Column(name = "outgoing_limit_minor", nullable = false)
    private long outgoingLimitMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    // ------------------------------------------------------------------ factories

    public static AccountLimit configure(String accountId,
                                         LimitWindow window,
                                         long outgoingLimitMinor,
                                         Currency currency) {
        if (accountId == null || accountId.isBlank()) {
            throw DomainException.validation("accountId is required to configure a limit");
        }
        if (window == null) {
            throw DomainException.validation("window is required to configure a limit");
        }
        if (currency == null) {
            throw DomainException.validation("currency is required to configure a limit");
        }
        requirePositive(outgoingLimitMinor);

        AccountLimit limit = new AccountLimit();
        limit.id = Ulid.nextId();
        limit.accountId = accountId;
        limit.window = window;
        limit.outgoingLimitMinor = outgoingLimitMinor;
        limit.currency = currency;
        Instant now = Instant.now();
        limit.createdAt = now;
        limit.updatedAt = now;
        return limit;
    }

    // ------------------------------------------------------------------ behaviour

    /** Raises or lowers the ceiling. Lowering never moves money — it only refuses new commitments. */
    public void changeOutgoingLimit(long outgoingLimitMinor) {
        requirePositive(outgoingLimitMinor);
        this.outgoingLimitMinor = outgoingLimitMinor;
        this.updatedAt = Instant.now();
    }

    /** How much of the window is still spendable given what is already committed. */
    public long headroomMinor(long usedMinor) {
        return outgoingLimitMinor - Math.max(usedMinor, 0L);
    }

    /** True when committing {@code amountMinor} on top of {@code usedMinor} stays within the limit. */
    public boolean allows(long usedMinor, long amountMinor) {
        return Math.addExact(Math.max(usedMinor, 0L), amountMinor) <= outgoingLimitMinor;
    }

    // ------------------------------------------------------------------ internals

    private static void requirePositive(long outgoingLimitMinor) {
        if (outgoingLimitMinor <= 0) {
            // "Never pay anything" is what freezing an account is for; a zero limit
            // would be an invisible freeze that support cannot explain.
            throw DomainException.of(AccountErrorCode.INVALID_AMOUNT,
                            "outgoing limit must be positive but was {}", outgoingLimitMinor)
                    .withDetail("outgoingLimitMinor", outgoingLimitMinor);
        }
    }
}
