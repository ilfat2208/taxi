package kz.taxi.payment.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Money;

/**
 * Turns an amount into the amount, the fee and the total the customer is debited.
 *
 * <p>Two rules, both enforced here so that no use case can bypass them:
 * <ul>
 *   <li>{@code total = amount + fee} — the schema has a CHECK constraint with
 *       exactly this arithmetic, and a payment that cannot satisfy it is a bug in
 *       the caller, not a user error;</li>
 *   <li>the fee is expressed in <em>basis points</em> of the amount and rounded
 *       HALF_UP in minor units, because a fee table written in minor units
 *       silently becomes wrong the day the amount changes.</li>
 * </ul>
 *
 * <p>The rate is a product decision, so it is passed in from configuration rather
 * than hard-coded: transfers are free today, merchant payments are not.
 */
public final class PaymentFees {

    private PaymentFees() {
    }

    /**
     * The three numbers of a payment, with the invariant already checked.
     *
     * @param amount what the recipient is owed
     * @param fee    what the platform charges for moving it
     * @param total  what is taken from the payer's account
     */
    public record FeeBreakdown(Money amount, Money fee, Money total) {

        public FeeBreakdown {
            if (amount == null || fee == null || total == null) {
                throw new IllegalArgumentException("amount, fee and total are all required");
            }
            if (amount.currency() != fee.currency() || amount.currency() != total.currency()) {
                throw new IllegalArgumentException("amount, fee and total must share one currency");
            }
            if (!amount.isPositive()) {
                throw DomainException.of(PaymentErrorCode.INVALID_AMOUNT,
                        "amount must be positive but was {}", amount.minorUnits());
            }
            if (fee.isNegative()) {
                throw new IllegalStateException("fee must not be negative: " + fee);
            }
            if (total.minorUnits() != Math.addExact(amount.minorUnits(), fee.minorUnits())) {
                throw new IllegalStateException(
                        "total must equal amount + fee, but " + total + " != " + amount + " + " + fee);
            }
        }
    }

    /** Computes the breakdown for a rate expressed in basis points (1 bp = 0.01%). */
    public static FeeBreakdown compute(Money amount, long feeBasisPoints) {
        if (feeBasisPoints < 0) {
            throw new IllegalArgumentException("fee basis points must not be negative: " + feeBasisPoints);
        }
        Money fee = amount.percentage(feeBasisPoints);
        return new FeeBreakdown(amount, fee, amount.plus(fee));
    }

    /** Applies the configured rate for the given payment type. */
    public static FeeBreakdown forType(PaymentType type, Money amount, long transferFeeBasisPoints,
                                       long merchantFeeBasisPoints) {
        return compute(amount, basisPointsFor(type, transferFeeBasisPoints, merchantFeeBasisPoints));
    }

    /** Transfers are free by default; the marketplace fee is the platform's revenue. */
    public static long basisPointsFor(PaymentType type, long transferFeeBasisPoints, long merchantFeeBasisPoints) {
        return switch (type) {
            case MERCHANT_PAYMENT -> merchantFeeBasisPoints;
            case P2P_TRANSFER, REFUND, PAYOUT, TOP_UP -> transferFeeBasisPoints;
        };
    }
}
