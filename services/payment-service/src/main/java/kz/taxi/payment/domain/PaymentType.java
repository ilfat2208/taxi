package kz.taxi.payment.domain;

/**
 * What the payment is for.
 *
 * <p>The values mirror the {@code payment.type} CHECK constraint of the frozen
 * schema, so the enum and the database agree by construction. Only the first two
 * are produced by this service today; the rest exist because the column exists
 * and a payment of an unknown type must not be silently accepted.
 */
public enum PaymentType {

    /** Person-to-person: the money leaves the payer and lands on the recipient's account. */
    P2P_TRANSFER,

    /**
     * Payment for a marketplace order: the money settles to the platform suspense
     * account without a target account, and order-service pays the merchant from
     * the {@code payment.completed} event (which carries {@code orderId},
     * {@code amountMinor} and {@code feeMinor}).
     */
    MERCHANT_PAYMENT,

    /** Money entering the system. Never initiated by this service. */
    TOP_UP,

    /** Money leaving the system. Never initiated by this service. */
    PAYOUT,

    /** A payment that only exists to move refunded money back. Never initiated by this service. */
    REFUND;

    /** True when the captured money must land on another customer's account. */
    public boolean requiresTargetAccount() {
        return this == P2P_TRANSFER;
    }

    /** The ledger operation the account service records for this type. */
    public String ledgerOperation() {
        return switch (this) {
            case P2P_TRANSFER -> "P2P_TRANSFER";
            case MERCHANT_PAYMENT -> "MERCHANT_PAYMENT";
            case REFUND -> "REFUND";
            case PAYOUT -> "PAYOUT";
            case TOP_UP -> "TOP_UP";
        };
    }
}
