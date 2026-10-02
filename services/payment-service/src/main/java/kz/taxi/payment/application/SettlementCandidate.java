package kz.taxi.payment.application;

import kz.taxi.common.core.money.Currency;

/**
 * One settlement to compute: a merchant and a currency.
 *
 * <p>A payout is per currency because a bank transfer is: there is no such thing as
 * paying a merchant "in whatever the customers used". It is a projection of the
 * settlement query rather than an entity, so the query that finds the work and the
 * object that describes it cannot drift apart.
 */
public record SettlementCandidate(String merchantId, Currency currency) {
}
