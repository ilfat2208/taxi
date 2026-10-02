package kz.taxi.payment.domain;

/**
 * Lifecycle of a payout to a merchant.
 *
 * <pre>
 *   PENDING --payout ok------> PAID     (merchant has the money)
 *           --payout failed--> FAILED   (retried; the debt is still on the books)
 * </pre>
 *
 * <p>{@code PENDING} is not an error state: it is what a settlement looks like when
 * the merchant has not said where to send the money yet. Recording the debt and not
 * paying it is the only honest option — the alternative is guessing an account.
 */
public enum SettlementStatus {

    PENDING,
    PAID,
    FAILED;

    public boolean isSettled() {
        return this == PAID;
    }
}
