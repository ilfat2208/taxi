package kz.taxi.account.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;

/**
 * Plain debit, used by the platform suspense account when money leaves the system
 * (a merchant settlement) or when a refund is funded from outside.
 *
 * @see Account#debitReserved(long) for the customer-facing path, which spends
 *      reserved funds instead of taking money that was never promised
 */
public final class AccountDebitSupport {

    private AccountDebitSupport() {
    }

    /**
     * Applies a debit of {@code amountMinor} to an account.
     *
     * <p>Customer accounts must never go negative, so the check lives here and the
     * database CHECK is the second line of defence. Suspense accounts represent the
     * outside world and are explicitly allowed to.
     */
    public static void debit(Account account, long amountMinor, Currency currency) {
        if (currency != null && account.getCurrency() != currency) {
            throw DomainException.of(AccountErrorCode.CURRENCY_MISMATCH,
                    "account {} is in {} but {} was supplied",
                    account.getId(), account.getCurrency(), currency);
        }
        if (amountMinor <= 0) {
            throw DomainException.of(AccountErrorCode.INVALID_AMOUNT,
                    "amount must be positive but was {}", amountMinor);
        }
        if (!account.isSystem() && account.getBalanceMinor() < amountMinor) {
            throw DomainException.of(AccountErrorCode.INSUFFICIENT_FUNDS,
                            "account {} has {} but {} is required", account.getId(),
                            account.getBalanceMinor(), amountMinor)
                    .withDetail("accountId", account.getId())
                    .withDetail("balanceMinor", account.getBalanceMinor())
                    .withDetail("requiredMinor", amountMinor);
        }
        account.applyDebit(amountMinor);
    }
}
