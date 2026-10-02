package kz.taxi.order.domain;

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
 * A checkout, and the state of the saga that produced it.
 *
 * <p>The row is the saga's memory. Two facts are stored side by side on purpose:
 * {@code status} is what the customer sees (PENDING_PAYMENT, PAID, CANCELLED) and
 * {@code sagaState} is how far the orchestration got. {@code PENDING_PAYMENT}
 * alone is ambiguous — stock not reserved yet, stock reserved but payment never
 * sent, payment sent with an unknown outcome — and each of those needs a different
 * next call, so the last completed step is written down <em>before</em> the remote
 * call it guards.
 *
 * <p>Everything that changes the row goes through a behaviour method, and each one
 * runs a legal-transition check from {@link OrderStatus}. A late
 * {@code payment.completed} event must not resurrect an order whose stock was
 * already released, and the state machine is the single place that rule lives.
 */
@Entity
@Table(name = "customer_order")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CustomerOrder {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "order_number", length = 32, nullable = false, updatable = false)
    private String orderNumber;

    @Column(name = "user_id", length = 64, nullable = false, updatable = false)
    private String userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 24, nullable = false)
    private OrderStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "subtotal_minor", nullable = false, updatable = false)
    private long subtotalMinor;

    @Column(name = "delivery_fee_minor", nullable = false, updatable = false)
    private long deliveryFeeMinor;

    @Column(name = "total_minor", nullable = false, updatable = false)
    private long totalMinor;

    @Column(name = "payment_id", length = 26)
    private String paymentId;

    @Column(name = "payment_status", length = 24)
    private String paymentStatus;

    @Column(name = "delivery_address", length = 512)
    private String deliveryAddress;

    @Column(name = "contact_phone", length = 32)
    private String contactPhone;

    @Column(name = "comment", length = 512)
    private String comment;

    @Column(name = "idempotency_key", length = 128, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "request_hash", length = 64, nullable = false, updatable = false)
    private String requestHash;

    @Enumerated(EnumType.STRING)
    @Column(name = "saga_state", length = 32)
    private SagaState sagaState;

    @Column(name = "failure_reason", length = 512)
    private String failureReason;

    @Column(name = "correlation_id", length = 64, updatable = false)
    private String correlationId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /**
     * Creates the order a checkout starts from.
     *
     * <p>{@code idempotencyKey} and {@code requestHash} are copied from the
     * request: the unique index on the key is the last line of defence when the
     * idempotency store is unavailable, and the hash lets a human explain a
     * duplicate-key incident.
     */
    public static CustomerOrder create(String orderNumber,
                                       String userId,
                                       Currency currency,
                                       OrderTotals totals,
                                       String idempotencyKey,
                                       String requestHash,
                                       String deliveryAddress,
                                       String contactPhone,
                                       String comment,
                                       String correlationId) {
        CustomerOrder order = new CustomerOrder();
        order.id = Ulid.nextId();
        order.orderNumber = orderNumber;
        order.userId = userId;
        order.currency = currency;
        order.subtotalMinor = totals.subtotalMinor();
        order.deliveryFeeMinor = totals.deliveryFeeMinor();
        order.totalMinor = totals.totalMinor();
        order.status = OrderStatus.PENDING_PAYMENT;
        order.sagaState = SagaState.NEW;
        order.idempotencyKey = idempotencyKey;
        order.requestHash = requestHash;
        order.deliveryAddress = deliveryAddress;
        order.contactPhone = contactPhone;
        order.comment = comment;
        order.correlationId = correlationId;
        Instant now = Instant.now();
        order.createdAt = now;
        order.updatedAt = now;
        return order;
    }

    // ------------------------------------------------------------------ queries

    public Money subtotal() {
        return Money.ofMinor(subtotalMinor, currency);
    }

    public Money deliveryFee() {
        return Money.ofMinor(deliveryFeeMinor, currency);
    }

    public Money total() {
        return Money.ofMinor(totalMinor, currency);
    }

    public String currencyCode() {
        return currency == null ? null : currency.name();
    }

    public boolean isPendingPayment() {
        return status == OrderStatus.PENDING_PAYMENT;
    }

    public boolean isPaid() {
        return status == OrderStatus.PAID;
    }

    public boolean isCancelled() {
        return status == OrderStatus.CANCELLED;
    }

    /** True when the saga still owes work in this state (used by the recovery job). */
    public boolean isInSagaState(SagaState state) {
        return sagaState == state;
    }

    /** True when the payment was never requested, so no money can have moved. */
    public boolean isPaymentUntouched() {
        return sagaState == null || sagaState == SagaState.NEW || sagaState == SagaState.STOCK_RESERVED;
    }

    // ------------------------------------------------------------------ behaviour

    /**
     * Moves the order to {@code target} and returns the status it came from.
     *
     * <p>Returning the previous status is what lets the caller write the history
     * row without re-reading the order: the transition and its audit record cannot
     * drift apart.
     */
    public OrderStatus transitionTo(OrderStatus target) {
        if (target == null || !status.canTransitionTo(target)) {
            throw DomainException.conflict("order {} cannot move from {} to {}", orderNumber, status, target);
        }
        OrderStatus previous = status;
        this.status = target;
        touch();
        return previous;
    }

    /** Records that the catalog confirmed the stock hold. */
    public void markStockReserved() {
        this.sagaState = SagaState.STOCK_RESERVED;
        touch();
    }

    /**
     * Records that the payment request is on the wire.
     *
     * <p>Written <em>before</em> the call: if the process dies during the call,
     * the recovery job finds an order that may already have a payment and asks the
     * payment service instead of assuming nothing happened.
     */
    public void markPaymentRequested() {
        this.sagaState = SagaState.PAYMENT_REQUESTED;
        touch();
    }

    /** Records that the payment call returned nothing usable. */
    public void markPaymentUnknown(String reason) {
        this.sagaState = SagaState.PAYMENT_UNKNOWN;
        this.failureReason = truncate(reason, OrderFailure.MAX_STORED_LENGTH);
        touch();
    }

    /** Money captured: the payment id is stored so a refund can find it later. */
    public void markPaid(PaymentOutcome payment) {
        transitionTo(OrderStatus.PAID);
        this.paymentId = payment.paymentId();
        this.paymentStatus = payment.status().name();
        this.paidAt = Instant.now();
        this.failureReason = null;
        // The stock commit is still owed: the order is paid even if that call fails.
        this.sagaState = SagaState.STOCK_COMMIT_PENDING;
    }

    /** The payment service refused the payment; nothing moved. */
    public void markPaymentDeclined(PaymentOutcome payment, OrderFailure failure) {
        this.paymentId = payment.paymentId();
        this.paymentStatus = PaymentStatus.FAILED.name();
        this.failureReason = failure.encode();
        touch();
    }

    /**
     * Cancels the order.
     *
     * <p>{@code stockReleaseSettled} says whether the goods are already back on
     * sale. When they are not, the saga state keeps that debt visible
     * ({@link SagaState#STOCK_RELEASE_PENDING}) so the recovery job can retry it;
     * a cancelled order that quietly keeps stock is inventory lost for the merchant.
     */
    public void cancel(OrderFailure failure, boolean stockReleaseSettled) {
        transitionTo(OrderStatus.CANCELLED);
        this.failureReason = failure.encode();
        this.sagaState = stockReleaseSettled ? SagaState.CANCELLED : SagaState.STOCK_RELEASE_PENDING;
    }

    /** Cancellation recorded from an operator action, with no error code attached. */
    public void cancelByUser(String reason, boolean stockReleaseSettled) {
        transitionTo(OrderStatus.CANCELLED);
        this.failureReason = truncate(reason, OrderFailure.MAX_STORED_LENGTH);
        this.sagaState = stockReleaseSettled ? SagaState.CANCELLED : SagaState.STOCK_RELEASE_PENDING;
    }

    /** Records a diagnostic reason without moving the order (support reads this). */
    public void recordNote(String reason) {
        this.failureReason = truncate(reason, OrderFailure.MAX_STORED_LENGTH);
        touch();
    }

    /** The saga has nothing left to do; this is what closes a PAID order. */
    public void markSagaCompleted() {
        this.sagaState = SagaState.COMPLETED;
        touch();
    }

    /** Aborts before any compensation is owed (nothing was ever reserved). */
    public void markSagaFailed(String reason) {
        this.sagaState = SagaState.FAILED;
        this.failureReason = truncate(reason, OrderFailure.MAX_STORED_LENGTH);
        transitionTo(OrderStatus.FAILED);
    }

    private void touch() {
        this.updatedAt = Instant.now();
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
