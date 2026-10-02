package kz.taxi.account.domain;

/** What an account is used for. */
public enum AccountType {

    /** Retail client wallet: source of transfers and marketplace payments. */
    CUSTOMER,

    /** Merchant settlement account: receives captured merchant payments. */
    MERCHANT,

    /**
     * Platform suspense account, one per currency.
     *
     * <p>Every movement of money must have two sides. When funds leave the closed
     * system (settlement to a merchant, a demo top-up funded from nowhere), the
     * counter-entry lands here instead of being silently omitted — which is what
     * keeps {@code SUM(debit) = SUM(credit)} true for the whole ledger and makes
     * reconciliation possible at all.
     */
    SYSTEM
}
