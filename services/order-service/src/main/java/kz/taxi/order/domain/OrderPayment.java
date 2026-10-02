package kz.taxi.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One merchant's share of an order, and the state of paying it.
 *
 * <p>A basket can hold goods from several sellers, and the platform's payment
 * contract is per merchant ({@code payment.merchant_id}), with settlement grouped
 * by (merchant, currency). Paying a multi-merchant basket with a single payment
 * would mean one seller is never paid for goods that were bought from them, so the
 * checkout charges every merchant separately and this row is the memory of that
 * charge.
 *
 * <p>The row is written <em>before</em> the payment call for its merchant and
 * updated when the answer arrives, for the same reason the order's saga state is:
 * a timeout then leaves a record of what was attempted, which is what the recovery
 * job and the reconciliation path need to finish the job without guessing.
 *
 * <p>An order is PAID only when every row is {@link OrderPaymentStatus#COMPLETED};
 * the settlement of a merchant happens off the payment event, so a row is also the
 * link between an order and the money a merchant is owed.
 */
@Entity
@Table(name = "order_payment")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OrderPayment {

    /** Column width of {@code failure_code}. */
    private static final int MAX_CODE_LENGTH = 64;
    /** Column width of {@code failure_reason}. */
    private static final int MAX_REASON_LENGTH = 512;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "order_id", length = 26, nullable = false, updatable = false)
    private String orderId;

    @Column(name = "merchant_id", length = 26, nullable = false, updatable = false)
    private String merchantId;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Column(name = "fee_minor", nullable = false)
    private long feeMinor;

    @Column(name = "total_minor", nullable = false)
    private long totalMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private OrderPaymentStatus status;

    @Column(name = "payment_id", length = 26)
    private String paymentId;

    @Column(name = "failure_code", length = MAX_CODE_LENGTH)
    private String failureCode;

    @Column(name = "failure_reason", length = MAX_REASON_LENGTH)
    private String failureReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /**
     * The charge of one merchant, before it was sent.
     *
     * <p>{@code fee_minor} starts at zero and {@code total_minor} equals
     * {@code amount_minor}: the platform fee is computed by the payment service
     * from the amount it is asked for, so the only honest thing to store before it
     * answers is "the customer owes this merchant this much, nothing added yet".
     * Both are overwritten by {@link #markCompleted(PaymentOutcome)}.
     */
    public static OrderPayment pending(String orderId, String merchantId, long amountMinor, Currency currency) {
        if (amountMinor <= 0) {
            throw new IllegalArgumentException("a merchant payment must be for a positive amount");
        }
        OrderPayment payment = new OrderPayment();
        payment.id = Ulid.nextId();
        payment.orderId = orderId;
        payment.merchantId = merchantId;
        payment.amountMinor = amountMinor;
        payment.feeMinor = 0L;
        payment.totalMinor = amountMinor;
        payment.currency = currency;
        payment.status = OrderPaymentStatus.PENDING;
        Instant now = Instant.now();
        payment.createdAt = now;
        payment.updatedAt = now;
        return payment;
    }

    // ------------------------------------------------------------------ queries

    public String currencyCode() {
        return currency == null ? null : currency.name();
    }

    /** True when the payment service charged this merchant exactly this amount, in this currency. */
    public boolean matches(PaymentOutcome payment) {
        return payment != null
                && payment.amountMinor() == amountMinor
                && payment.currency() != null
                && currencyCode() != null
                && payment.currency().equalsIgnoreCase(currencyCode());
    }

    /**
     * This line, seen as a payment outcome (what the order's own fields are set from).
     *
     * <p>A line that is not settled reports {@link PaymentStatus#UNKNOWN}: "we asked
     * and got nothing yet" is not the same fact as "the merchant was paid", and a
     * caller that needs an answer has to be able to tell the two apart.
     */
    public PaymentOutcome asOutcome() {
        PaymentStatus outcome = switch (status) {
            case COMPLETED -> PaymentStatus.COMPLETED;
            case FAILED -> PaymentStatus.FAILED;
            case PENDING, REFUNDED -> PaymentStatus.UNKNOWN;
        };
        return new PaymentOutcome(paymentId, null, outcome, amountMinor, feeMinor, totalMinor,
                currencyCode(), failureCode, failureReason);
    }

    // ------------------------------------------------------------------ behaviour

    /**
     * Money moved for this merchant.
     *
     * <p>Idempotent by status: a redelivered event and a synchronous answer that
     * was already applied say the same thing, and applying them twice must not
     * change the row or produce a second settlement.
     */
    public void markCompleted(PaymentOutcome payment) {
        if (status == OrderPaymentStatus.COMPLETED) {
            return;
        }
        this.paymentId = payment.paymentId();
        this.feeMinor = Math.max(payment.feeMinor(), 0L);
        // The payment service's own total is what the payer is debited; recomputing
        // it from the amount keeps this row consistent with the amount we asked for
        // (a response that disagrees is refused by the caller before we get here).
        this.totalMinor = Math.addExact(amountMinor, feeMinor);
        this.status = OrderPaymentStatus.COMPLETED;
        this.failureCode = null;
        this.failureReason = null;
        touch();
    }

    /** The payment service refused this merchant; nothing moved for them. */
    public void markFailed(PaymentOutcome payment) {
        if (payment.paymentId() != null) {
            this.paymentId = payment.paymentId();
        }
        this.status = OrderPaymentStatus.FAILED;
        this.failureCode = truncate(payment.failureCode(), MAX_CODE_LENGTH);
        this.failureReason = truncate(payment.failureReason(), MAX_REASON_LENGTH);
        touch();
    }

    /** The merchant's money went back to the customer: this line owes nothing. */
    public void markRefunded() {
        if (status == OrderPaymentStatus.REFUNDED) {
            return;
        }
        this.status = OrderPaymentStatus.REFUNDED;
        touch();
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
