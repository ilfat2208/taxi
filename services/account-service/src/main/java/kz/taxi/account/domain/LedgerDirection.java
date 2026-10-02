package kz.taxi.account.domain;

/**
 * Side of a double-entry posting.
 *
 * <p>Amounts are always stored positive; the direction carries the sign. That
 * makes the ledger invariant expressible as a single query and prevents the
 * classic bug where a negative amount is posted twice with the wrong sign.
 */
public enum LedgerDirection {

    /** Money leaves the account. */
    DEBIT,

    /** Money arrives on the account. */
    CREDIT
}
