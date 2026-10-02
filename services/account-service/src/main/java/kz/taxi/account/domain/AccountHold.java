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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Funds reserved for one specific payment.
 *
 * <p>The hold carries the reference of the thing it was created for
 * ({@code referenceType}/{@code referenceId}) and the client's
 * {@code idempotencyKey}. Both matter:
 * <ul>
 *   <li>the reference makes the hold discoverable from the payment side, which is
 *       how a crashed saga finds out whether it ever reserved funds;</li>
 *   <li>the unique index on the idempotency key means a retried request cannot
 *       reserve the same money twice, even if two replicas handle it at once.</li>
 * </ul>
 */
@Entity
@Table(name = "account_hold")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AccountHold {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "account_id", length = 26, nullable = false, updatable = false)
    private String accountId;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private HoldStatus status;

    @Column(name = "reason", length = 255)
    private String reason;

    @Column(name = "reference_type", length = 32, nullable = false, updatable = false)
    private String referenceType;

    @Column(name = "reference_id", length = 64, nullable = false, updatable = false)
    private String referenceId;

    @Column(name = "idempotency_key", length = 128, updatable = false)
    private String idempotencyKey;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    public static AccountHold place(String accountId,
                                    long amountMinor,
                                    Currency currency,
                                    String referenceType,
                                    String referenceId,
                                    String idempotencyKey,
                                    String reason,
                                    Instant expiresAt) {
        AccountHold hold = new AccountHold();
        hold.id = Ulid.nextId();
        hold.accountId = accountId;
        hold.amountMinor = amountMinor;
        hold.currency = currency;
        hold.status = HoldStatus.ACTIVE;
        hold.referenceType = referenceType;
        hold.referenceId = referenceId;
        hold.idempotencyKey = idempotencyKey;
        hold.reason = reason;
        hold.expiresAt = expiresAt;
        Instant now = Instant.now();
        hold.createdAt = now;
        hold.updatedAt = now;
        return hold;
    }

    // ------------------------------------------------------------------ queries

    public boolean isActive() {
        return status == HoldStatus.ACTIVE;
    }

    public boolean isExpired(Instant now) {
        return expiresAt != null && expiresAt.isBefore(now);
    }

    // ------------------------------------------------------------------ behaviour

    /** Terminal: the reserved money has moved. Idempotent. */
    public void capture() {
        if (status == HoldStatus.CAPTURED) {
            return;
        }
        requireActive();
        this.status = HoldStatus.CAPTURED;
        touch();
    }

    /** Terminal: the reserved money is available again. Idempotent. */
    public void release() {
        if (status == HoldStatus.RELEASED) {
            return;
        }
        requireActive();
        this.status = HoldStatus.RELEASED;
        touch();
    }

    /** Terminal: nobody ever finished the payment that created this hold. */
    public void expire() {
        if (status == HoldStatus.EXPIRED) {
            return;
        }
        requireActive();
        this.status = HoldStatus.EXPIRED;
        touch();
    }

    public void requireActive() {
        if (!isActive()) {
            throw DomainException.of(AccountErrorCode.HOLD_NOT_ACTIVE,
                            "hold {} is {}", id, status)
                    .withDetail("holdId", id)
                    .withDetail("status", status.name());
        }
    }

    private void touch() {
        this.updatedAt = Instant.now();
    }
}
