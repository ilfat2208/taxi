package kz.taxi.account.domain;

/**
 * Business operation recorded on a ledger entry.
 *
 * <p>Kept as an enum rather than free text because it ends up in statements,
 * limits and reporting: "why did my balance change" must be answerable by a
 * machine, not by parsing a description.
 */
public enum LedgerOperation {

    /** Funds added by an operator (demo money, corrections). */
    TOP_UP,

    /** Person-to-person transfer. */
    P2P_TRANSFER,

    /** Payment to a merchant, settled into the platform suspense account. */
    MERCHANT_PAYMENT,

    /** Money returned to the payer. */
    REFUND,

    /** Payout to an external account or card. */
    PAYOUT,

    /** Manual adjustment by support with a reason. */
    ADJUSTMENT
}
