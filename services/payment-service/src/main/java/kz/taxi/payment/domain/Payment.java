package kz.taxi.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.error.ErrorCode;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One payment and the state machine that governs it.
 *
 * <p>This entity owns no money: the account service owns the balances. What it
 * owns is the <em>story</em> of a money movement — how far it got, which hold it
 * is working with, and why it stopped. That story has to survive a process kill
 * at any instruction, which is why every behaviour method below is a tiny,
 * legal-only step and why the saga step marker ({@link PaymentSagaMarker}) is
 * written <em>before</em> the remote call it describes.
 *
 * <p>Illegal transitions do not "just return false": they throw with a code the
 * API can hand to a client. The one deliberate exception is a repeat of a step
 * that means the same thing twice (marking a payment failed twice), which returns
 * {@code false} — compensation runs after failures and must itself be safe to
 * repeat.
 */
@Entity
@Table(name = "payment")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Payment {

    /** Longest text the schema accepts for a failure reason. */
    private static final int FAILURE_REASON_LENGTH = 512;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "payment_number", length = 32, nullable = false, updatable = false)
    private String paymentNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", length = 24, nullable = false, updatable = false)
    private PaymentType type;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private PaymentStatus status;

    @Column(name = "owner_user_id", length = 64, nullable = false, updatable = false)
    private String ownerUserId;

    @Column(name = "source_account_id", length = 26)
    private String sourceAccountId;

    @Column(name = "target_account_id", length = 26)
    private String targetAccountId;

    @Column(name = "merchant_id", length = 26)
    private String merchantId;

    @Column(name = "order_id", length = 26)
    private String orderId;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(name = "fee_minor", nullable = false)
    private long feeMinor;

    @Column(name = "total_minor", nullable = false)
    private long totalMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false)
    private Currency currency;

    @Column(name = "description", length = 255)
    private String description;

    @Column(name = "idempotency_key", length = 128, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "request_hash", length = 64, nullable = false, updatable = false)
    private String requestHash;

    @Column(name = "correlation_id", length = 64)
    private String correlationId;

    @Column(name = "failure_code", length = 64)
    private String failureCode;

    @Column(name = "failure_reason", length = FAILURE_REASON_LENGTH)
    private String failureReason;

    /** Packed {@link PaymentSagaMarker}: {@code null} once the saga reached a terminal state. */
    @Column(name = "saga_state", length = 32)
    private String sagaState;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    /**
     * When this payment was included in a merchant settlement.
     *
     * <p>A sale is settled exactly once. The flag lives on the payment (not only on
     * the settlement's line table) so the settlement query can walk the partial index
     * over unsettled sales instead of scanning the whole history.
     */
    @Column(name = "settled_at")
    private Instant settledAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    public static Payment initiate(PaymentIntent intent, PaymentFees.FeeBreakdown money) {
        Payment payment = new Payment();
        payment.id = Ulid.nextId();
        payment.paymentNumber = PaymentNumber.next();
        payment.type = intent.type();
        payment.status = PaymentStatus.INITIATED;
        payment.ownerUserId = intent.ownerUserId();
        payment.sourceAccountId = intent.sourceAccountId();
        payment.targetAccountId = intent.targetAccountId();
        payment.merchantId = intent.merchantId();
        payment.orderId = intent.orderId();
        payment.amountMinor = money.amount().minorUnits();
        payment.feeMinor = money.fee().minorUnits();
        payment.totalMinor = money.total().minorUnits();
        payment.currency = money.amount().currency();
        payment.description = intent.description();
        payment.idempotencyKey = intent.idempotencyKey();
        payment.requestHash = intent.requestHash();
        payment.correlationId = intent.correlationId();
        Instant now = Instant.now();
        payment.createdAt = now;
        payment.updatedAt = now;
        return payment;
    }

    // ------------------------------------------------------------------ queries

    public Money amount() {
        return Money.ofMinor(amountMinor, currency);
    }

    public Money fee() {
        return Money.ofMinor(feeMinor, currency);
    }

    /** What the payer's account is debited: {@code amount + fee}. */
    public Money total() {
        return Money.ofMinor(totalMinor, currency);
    }

    public boolean isOwnedBy(String userId) {
        return ownerUserId != null && ownerUserId.equals(userId);
    }

    public boolean hasTargetAccount() {
        return targetAccountId != null && !targetAccountId.isBlank();
    }

    /** The saga step this payment is in, or {@code null} when there is none to resume. */
    public PaymentSagaMarker sagaMarker() {
        return PaymentSagaMarker.parse(sagaState);
    }

    // ------------------------------------------------------------------ behaviour

    /**
     * Requests the hold: the last moment before money can be reserved.
     *
     * <p>Callers must persist this <em>before</em> calling the account service, so
     * that a crash right after the hold leaves a payment the recovery job can find.
     * Repeating the step on an already pending payment changes nothing and returns
     * {@code false} — a retried saga step is not a second hold.
     *
     * @return true when the status actually changed
     */
    public boolean markPending() {
        if (status == PaymentStatus.PENDING) {
            return false;
        }
        requireTransition(PaymentStatus.PENDING, PaymentErrorCode.HOLD_FAILED, "reserve funds");
        transitionTo(PaymentStatus.PENDING);
        this.sagaState = PaymentSagaMarker.holding().toColumnValue();
        return true;
    }

    /**
     * Records the hold the account service confirmed.
     *
     * <p>Without this the recovery job cannot tell a captured hold from an expired
     * one (see {@link PaymentSagaMarker}); with it, every later decision is made on
     * facts instead of on a guess.
     */
    public void recordHold(String holdId) {
        requirePending("record the hold");
        this.sagaState = PaymentSagaMarker.held(holdId).toColumnValue();
        touch();
    }

    /** Marks, before the call, that a capture for this hold has been requested. */
    public void beginCapture(String holdId) {
        requirePending("capture the hold");
        this.sagaState = PaymentSagaMarker.capturing(holdId).toColumnValue();
        touch();
    }

    /**
     * Marks, before the call, that the saga is compensating.
     *
     * <p>The marker is what stops a recovery job from "helpfully" completing a
     * payment whose capture already failed: the intent to give the money back is
     * durable, not a local variable.
     */
    public void beginRelease(String holdId, String reason) {
        requirePending("release the hold");
        this.sagaState = PaymentSagaMarker.releasing(holdId).toColumnValue();
        this.failureReason = truncate(reason);
        touch();
    }

    /**
     * Money moved: the payment is done.
     *
     * @throws DomainException {@code PAYMENT_ALREADY_COMPLETED} when it is already
     *                         completed or reversed, {@code PAYMENT_NOT_COMPLETED}
     *                         when the saga never reserved funds to capture
     */
    /**
     * Marks the sale as settled.
     *
     * <p>Idempotent: a settlement run retried after a crash must not fail on the rows
     * it already included.
     */
    public void markSettled(Instant when) {
        if (status != PaymentStatus.COMPLETED) {
            throw illegal(PaymentErrorCode.PAYMENT_NOT_COMPLETED, "be settled");
        }
        if (settledAt == null) {
            this.settledAt = when;
            touch();
        }
    }

    public boolean isSettled() {
        return settledAt != null;
    }

    public void markCompleted() {
        if (status == PaymentStatus.COMPLETED || status == PaymentStatus.REVERSED) {
            throw illegal(PaymentErrorCode.PAYMENT_ALREADY_COMPLETED, "be completed");
        }
        requireTransition(PaymentStatus.COMPLETED, PaymentErrorCode.PAYMENT_NOT_COMPLETED, "be completed");
        Instant now = Instant.now();
        transitionTo(PaymentStatus.COMPLETED);
        this.completedAt = now;
        this.sagaState = null;
        this.failureCode = null;
        this.failureReason = null;
        touch(now);
    }

    /**
     * The payment is closed and no money moved (or the money was given back).
     *
     * <p>The failure code is whatever rejected the payment — this service's own or
     * one the account service produced — so a support agent reads the real reason
     * instead of a generic "failed".
     *
     * @return false when the payment was already failed — compensation is retried
     *         after failures itself, and a second attempt must not explode
     */
    public boolean markFailed(ErrorCode errorCode, String reason) {
        if (status == PaymentStatus.FAILED) {
            return false;
        }
        if (status.isSettled()) {
            throw illegal(PaymentErrorCode.PAYMENT_ALREADY_COMPLETED, "fail");
        }
        requireTransition(PaymentStatus.FAILED, PaymentErrorCode.PAYMENT_NOT_COMPLETED, "fail");
        transitionTo(PaymentStatus.FAILED);
        this.failureCode = errorCode == null ? null : errorCode.code();
        this.failureReason = truncate(reason);
        this.sagaState = null;
        touch();
        return true;
    }

    /**
     * A completed payment was refunded in full.
     *
     * <p>Partial refunds deliberately leave the payment {@code COMPLETED}: the
     * payment itself was executed, and only the reversal of its full value is a
     * state of its own.
     */
    public void markReversed(String reason) {
        if (status != PaymentStatus.COMPLETED) {
            throw illegal(PaymentErrorCode.PAYMENT_NOT_REVERSIBLE, "be reversed");
        }
        requireTransition(PaymentStatus.REVERSED, PaymentErrorCode.PAYMENT_NOT_REVERSIBLE, "be reversed");
        transitionTo(PaymentStatus.REVERSED);
        this.failureReason = truncate(reason);
        this.sagaState = null;
        touch();
    }

    // ------------------------------------------------------------------ internals

    private void requirePending(String action) {
        if (status != PaymentStatus.PENDING) {
            throw illegal(PaymentErrorCode.HOLD_FAILED, action);
        }
    }

    private void requireTransition(PaymentStatus target, PaymentErrorCode code, String action) {
        if (!status.canTransitionTo(target)) {
            throw DomainException.of(code, "payment {} is {} and cannot {}", id, status, action)
                    .withDetail("paymentId", id)
                    .withDetail("status", status.name())
                    .withDetail("attemptedStatus", target.name());
        }
    }

    private void transitionTo(PaymentStatus target) {
        this.status = target;
    }

    private DomainException illegal(PaymentErrorCode code, String action) {
        return DomainException.of(code, "payment {} is {} and cannot {}", id, status, action)
                .withDetail("paymentId", id)
                .withDetail("status", status.name());
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() <= FAILURE_REASON_LENGTH ? value : value.substring(0, FAILURE_REASON_LENGTH);
    }

    private void touch() {
        touch(Instant.now());
    }

    private void touch(Instant now) {
        this.updatedAt = now;
    }
}
