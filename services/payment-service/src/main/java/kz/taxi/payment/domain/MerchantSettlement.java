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

import java.math.BigDecimal;
import java.time.Instant;

/**
 * What the platform owes one merchant for one period in one currency.
 *
 * <p>The money model of a marketplace commission, written down explicitly:
 *
 * <pre>
 *   customer paid   = goods + platform commission   (customer_paid_minor)
 *   merchant gets   = goods                         (net_minor == gross_minor)
 *   platform keeps  = commission                    (commission_minor)
 * </pre>
 *
 * <p>All three are stored, and the database enforces both identities. That is what
 * lets a merchant reconcile a payout against its own sales without asking anyone,
 * and what makes the platform's revenue a query rather than a spreadsheet.
 *
 * <p>The debt is a fact and the payment is an action, so they are separate columns:
 * a settlement exists (PENDING) from the moment the period closes, and only becomes
 * PAID when the money has actually left the suspension account.
 */
@Entity
@Table(name = "merchant_settlement")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MerchantSettlement {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "settlement_number", length = 32, nullable = false, updatable = false)
    private String settlementNumber;

    @Column(name = "merchant_id", length = 26, nullable = false, updatable = false)
    private String merchantId;

    @Column(name = "owner_user_id", length = 64, nullable = false, updatable = false)
    private String ownerUserId;

    @Column(name = "payout_account_id", length = 26)
    private String payoutAccountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "period_start", nullable = false, updatable = false)
    private Instant periodStart;

    @Column(name = "period_end", nullable = false, updatable = false)
    private Instant periodEnd;

    @Column(name = "payment_count", nullable = false, updatable = false)
    private int paymentCount;

    @Column(name = "gross_minor", nullable = false, updatable = false)
    private long grossMinor;

    @Column(name = "commission_minor", nullable = false, updatable = false)
    private long commissionMinor;

    @Column(name = "customer_paid_minor", nullable = false, updatable = false)
    private long customerPaidMinor;

    @Column(name = "net_minor", nullable = false, updatable = false)
    private long netMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private SettlementStatus status;

    @Column(name = "idempotency_key", length = 128, nullable = false, updatable = false)
    private String idempotencyKey;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Column(name = "failure_reason", length = 512)
    private String failureReason;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    /** Amounts of one merchant's sales during the period, in minor units. */
    public record PeriodTotals(int paymentCount,
                               long grossMinor,
                               long commissionMinor,
                               long customerPaidMinor) {

        public PeriodTotals {
            if (paymentCount <= 0) {
                throw new IllegalArgumentException("a settlement must cover at least one payment");
            }
            if (grossMinor < 0 || commissionMinor < 0) {
                throw new IllegalArgumentException("settlement amounts cannot be negative");
            }
            long expectedCustomerPaid = grossMinor + commissionMinor;
            if (customerPaidMinor != expectedCustomerPaid) {
                throw new IllegalArgumentException(
                        "customer paid %d but goods %d plus commission %d is %d"
                                .formatted(customerPaidMinor, grossMinor, commissionMinor, expectedCustomerPaid));
            }
        }
    }

    public static MerchantSettlement of(String merchantId,
                                        String ownerUserId,
                                        String payoutAccountId,
                                        Currency currency,
                                        Instant periodStart,
                                        Instant periodEnd,
                                        PeriodTotals totals) {

        MerchantSettlement settlement = new MerchantSettlement();
        settlement.id = Ulid.nextId();
        settlement.settlementNumber = SettlementNumber.forPeriod(periodEnd, settlement.id);
        settlement.merchantId = merchantId;
        settlement.ownerUserId = ownerUserId;
        settlement.payoutAccountId = payoutAccountId;
        settlement.currency = currency;
        settlement.periodStart = periodStart;
        settlement.periodEnd = periodEnd;
        settlement.paymentCount = totals.paymentCount();
        settlement.grossMinor = totals.grossMinor();
        settlement.commissionMinor = totals.commissionMinor();
        settlement.customerPaidMinor = totals.customerPaidMinor();
        // The merchant is paid the value of the goods; the commission was already
        // collected from the customer at checkout and stays with the platform.
        settlement.netMinor = totals.grossMinor();
        settlement.status = SettlementStatus.PENDING;
        settlement.idempotencyKey = idempotencyKey(merchantId, currency, periodEnd);
        Instant now = Instant.now();
        settlement.createdAt = now;
        settlement.updatedAt = now;
        return settlement;
    }

    /**
     * Identity of a settlement: one per merchant, currency and period end.
     *
     * <p>Two runs of the same period must address the same row. Deriving the key
     * instead of storing a random one is what makes the scheduled job safely
     * repeatable — including when a previous run crashed halfway.
     */
    public static String idempotencyKey(String merchantId, Currency currency, Instant periodEnd) {
        return "SETTLEMENT:%s:%s:%d".formatted(merchantId, currency.name(), periodEnd.getEpochSecond());
    }

    /** Records where the money is going; a merchant may change it until payout. */
    public void assignPayoutAccount(String accountId) {
        if (status.isSettled()) {
            throw DomainException.of(PaymentErrorCode.SETTLEMENT_ALREADY_PAID,
                    "settlement {} is already paid and cannot be redirected", id);
        }
        this.payoutAccountId = accountId;
        this.updatedAt = Instant.now();
    }

    public void markPaid(Instant paidAt) {
        if (status.isSettled()) {
            return;
        }
        this.status = SettlementStatus.PAID;
        this.paidAt = paidAt;
        this.failureReason = null;
        this.updatedAt = Instant.now();
    }

    public void markFailed(String reason) {
        if (status.isSettled()) {
            return;
        }
        this.status = SettlementStatus.FAILED;
        this.failureReason = reason == null ? null : reason.substring(0, Math.min(reason.length(), 512));
        this.updatedAt = Instant.now();
    }

    public boolean isPayable() {
        return status != SettlementStatus.PAID;
    }

    /** False while the merchant has not told us where to send the money. */
    public boolean hasPayoutAccount() {
        return payoutAccountId != null && !payoutAccountId.isBlank();
    }

    public Money net() {
        return Money.ofMinor(netMinor, currency);
    }

    public Money commission() {
        return Money.ofMinor(commissionMinor, currency);
    }

    /** Rendered for statements and logs so nobody divides by 100 in their head. */
    public String describe() {
        return "%s: %s net, %s commission, %d payments"
                .formatted(settlementNumber, net(), commission(), paymentCount);
    }

    /** Human-readable settlement number: SET-yyMMdd-<ulid suffix>. */
    private static final class SettlementNumber {

        private SettlementNumber() {
        }

        static String forPeriod(Instant periodEnd, String id) {
            java.time.ZonedDateTime day = periodEnd.atZone(java.time.ZoneOffset.UTC);
            String date = "%02d%02d%02d".formatted(
                    day.getYear() % 100, day.getMonthValue(), day.getDayOfMonth());
            return "SET-" + date + "-" + id.substring(id.length() - 5);
        }
    }

    /** Truncated cents helper used by statements (never for arithmetic). */
    public BigDecimal netAsDecimal() {
        return net().toBigDecimal();
    }
}
