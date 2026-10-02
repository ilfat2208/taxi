package kz.taxi.account.domain;

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
import kz.taxi.common.core.money.Money;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * A wallet and its balance.
 *
 * <p>Two numbers, and the difference between them is the whole point:
 * <ul>
 *   <li>{@code balanceMinor} — what the account owns, the projection of the ledger;</li>
 *   <li>{@code heldMinor} — what is already promised to an in-flight payment.</li>
 * </ul>
 * {@code available = balance - held} is what the customer can actually spend. A
 * model without holds forces an ugly choice: either money moves before the
 * payment succeeds, or a payment can be started that will later fail for lack of
 * funds. Holds remove that choice.
 *
 * <p>All mutations go through behaviour methods that enforce the invariants the
 * database also enforces with CHECK constraints. Two layers, because a money bug
 * that reaches production is far more expensive than a rejected request.
 */
@Entity
@Table(name = "account")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Account {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "owner_user_id", length = 64, nullable = false, updatable = false)
    private String ownerUserId;

    @Column(name = "owner_phone", length = 32)
    private String ownerPhone;

    @Column(name = "display_name", length = 128)
    private String displayName;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", length = 16, nullable = false, updatable = false)
    private AccountType type;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private AccountStatus status;

    @Column(name = "balance_minor", nullable = false)
    private long balanceMinor;

    @Column(name = "held_minor", nullable = false)
    private long heldMinor;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    // ------------------------------------------------------------------ factories

    public static Account open(String ownerUserId,
                               String ownerPhone,
                               String displayName,
                               AccountType type,
                               Currency currency) {
        Account account = new Account();
        account.id = Ulid.nextId();
        account.ownerUserId = ownerUserId;
        account.ownerPhone = ownerPhone;
        account.displayName = displayName;
        account.type = type;
        account.currency = currency;
        account.status = AccountStatus.ACTIVE;
        account.balanceMinor = 0L;
        account.heldMinor = 0L;
        Instant now = Instant.now();
        account.createdAt = now;
        account.updatedAt = now;
        return account;
    }

    /** The platform suspense account that balances money entering or leaving the system. */
    public static Account openSystemAccount(Currency currency) {
        return open("SYSTEM", null, "Platform suspense (%s)".formatted(currency), AccountType.SYSTEM, currency);
    }

    // ------------------------------------------------------------------ queries

    public Money balance() {
        return Money.ofMinor(balanceMinor, currency);
    }

    public Money held() {
        return Money.ofMinor(heldMinor, currency);
    }

    /** Funds the customer can spend right now. */
    public Money available() {
        return Money.ofMinor(availableMinor(), currency);
    }

    public long availableMinor() {
        return balanceMinor - heldMinor;
    }

    public boolean isActive() {
        return status == AccountStatus.ACTIVE;
    }

    public boolean isSystem() {
        return type == AccountType.SYSTEM;
    }

    public boolean isOwnedBy(String userId) {
        return ownerUserId != null && ownerUserId.equals(userId);
    }

    // ------------------------------------------------------------------ behaviour

    /** Reserves funds for an in-flight payment without moving them. */
    public void reserve(long amountMinor, Currency currency) {
        requireActive();
        requireSameCurrency(currency);
        requirePositive(amountMinor);

        if (availableMinor() < amountMinor) {
            throw DomainException.of(AccountErrorCode.INSUFFICIENT_FUNDS,
                            "account {} has {} available but {} is required",
                            id, available().toString(), Money.ofMinor(amountMinor, currency))
                    .withDetail("accountId", id)
                    .withDetail("availableMinor", availableMinor())
                    .withDetail("requiredMinor", amountMinor);
        }
        this.heldMinor = Math.addExact(this.heldMinor, amountMinor);
        touch();
    }

    /** Gives reserved funds back (payment failed, order cancelled). */
    public void releaseReserved(long amountMinor) {
        requirePositive(amountMinor);
        if (heldMinor < amountMinor) {
            throw DomainException.of(AccountErrorCode.HOLD_NOT_ACTIVE,
                            "account {} has only {} reserved but {} is being released",
                            id, Money.ofMinor(heldMinor, currency), Money.ofMinor(amountMinor, currency))
                    .withDetail("accountId", id)
                    .withDetail("heldMinor", heldMinor);
        }
        this.heldMinor -= amountMinor;
        touch();
    }

    /** Turns reserved funds into a real debit. */
    public void debitReserved(long amountMinor) {
        requireActive();
        if (heldMinor < amountMinor) {
            throw DomainException.of(AccountErrorCode.HOLD_NOT_ACTIVE,
                    "account {} has only {} reserved", id, Money.ofMinor(heldMinor, currency));
        }
        if (balanceMinor < amountMinor) {
            throw DomainException.of(AccountErrorCode.INSUFFICIENT_FUNDS,
                    "account {} has only {}", id, balance().toString());
        }
        this.heldMinor -= amountMinor;
        this.balanceMinor -= amountMinor;
        touch();
    }

    /** Adds money to the account. */
    public void credit(long amountMinor, Currency currency) {
        requireActive();
        requireSameCurrency(currency);
        requirePositive(amountMinor);
        this.balanceMinor = Math.addExact(this.balanceMinor, amountMinor);
        touch();
    }

    /**
     * Reduces the balance without touching reserved funds.
     *
     * <p>Package-visible on purpose: callers go through
     * {@link AccountDebitSupport#debit(Account, long, Currency)}, which enforces
     * "customer balances never go negative". Making the raw mutation private to the
     * domain package keeps that rule enforceable by reading one class.
     */
    void applyDebit(long amountMinor) {
        this.balanceMinor = Math.subtractExact(this.balanceMinor, amountMinor);
        touch();
    }

    // ------------------------------------------------------------------ operator actions

    /** Freezes the account: reads still work, money stops moving. */
    public void freeze() {
        if (status == AccountStatus.CLOSED) {
            throw DomainException.of(AccountErrorCode.ACCOUNT_NOT_ACTIVE, "account {} is closed", id);
        }
        this.status = AccountStatus.FROZEN;
        touch();
    }

    public void activate() {
        if (status == AccountStatus.CLOSED) {
            throw DomainException.of(AccountErrorCode.ACCOUNT_NOT_ACTIVE, "account {} is closed", id);
        }
        this.status = AccountStatus.ACTIVE;
        touch();
    }

    // ------------------------------------------------------------------ internals

    private void requireActive() {
        if (!isActive()) {
            throw DomainException.of(AccountErrorCode.ACCOUNT_NOT_ACTIVE,
                            "account {} is {}", id, status)
                    .withDetail("accountId", id)
                    .withDetail("status", status.name());
        }
    }

    private void requireSameCurrency(Currency other) {
        if (other != null && currency != other) {
            throw DomainException.of(AccountErrorCode.CURRENCY_MISMATCH,
                            "account {} is in {} but {} was supplied", id, currency, other)
                    .withDetail("accountCurrency", currency.name())
                    .withDetail("requestCurrency", other.name());
        }
    }

    private static void requirePositive(long amountMinor) {
        if (amountMinor <= 0) {
            throw DomainException.of(AccountErrorCode.INVALID_AMOUNT, "amount must be positive but was {}", amountMinor);
        }
    }

    private void touch() {
        this.updatedAt = Instant.now();
    }
}
