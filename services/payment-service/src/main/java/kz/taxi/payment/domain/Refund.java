package kz.taxi.payment.domain;

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
 * One refund of one payment.
 *
 * <p>The row is created and committed <em>before</em> the payer is credited, and
 * its id is the business reference of that credit ({@code (REFUND, refundId)}).
 * That ordering is the whole design: a process that dies between the two leaves a
 * refund that says "this credit was intended" and the account service can be
 * asked to do it again without ever paying twice.
 */
@Entity
@Table(name = "refund")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Refund {

    private static final int REASON_LENGTH = 255;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "payment_id", length = 26, nullable = false, updatable = false)
    private String paymentId;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private RefundStatus status;

    @Column(name = "reason", length = REASON_LENGTH)
    private String reason;

    @Column(name = "idempotency_key", length = 128, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    public static Refund initiate(String paymentId, long amountMinor, Currency currency, String reason,
                                  String idempotencyKey) {
        if (amountMinor <= 0) {
            throw DomainException.of(PaymentErrorCode.INVALID_AMOUNT,
                    "refund amount must be positive but was {}", amountMinor);
        }
        Refund refund = new Refund();
        refund.id = Ulid.nextId();
        refund.paymentId = paymentId;
        refund.amountMinor = amountMinor;
        refund.currency = currency;
        refund.status = RefundStatus.INITIATED;
        refund.reason = reason == null || reason.length() <= REASON_LENGTH
                ? reason
                : reason.substring(0, REASON_LENGTH);
        refund.idempotencyKey = idempotencyKey;
        Instant now = Instant.now();
        refund.createdAt = now;
        refund.updatedAt = now;
        return refund;
    }

    public Money amount() {
        return Money.ofMinor(amountMinor, currency);
    }

    public boolean isCompleted() {
        return status == RefundStatus.COMPLETED;
    }

    /** The payer was credited: the refund is done. */
    public void complete() {
        if (status == RefundStatus.COMPLETED) {
            return;
        }
        if (status == RefundStatus.FAILED) {
            throw DomainException.of(PaymentErrorCode.HOLD_FAILED,
                    "refund {} already failed and cannot be completed", id);
        }
        this.status = RefundStatus.COMPLETED;
        touch();
    }

    /** The credit was rejected: the money did not move, and a later refund may still be attempted. */
    public void fail(String reason) {
        if (status == RefundStatus.COMPLETED) {
            // The credit landed; a failure reported afterwards was a lie (a timeout
            // on the response). The money is out, so the refund stays completed.
            return;
        }
        this.status = RefundStatus.FAILED;
        this.reason = reason == null || reason.length() <= REASON_LENGTH
                ? reason
                : reason.substring(0, REASON_LENGTH);
        touch();
    }

    private void touch() {
        this.updatedAt = Instant.now();
    }
}
