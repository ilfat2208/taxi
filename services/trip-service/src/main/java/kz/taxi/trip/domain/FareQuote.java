package kz.taxi.trip.domain;

/**
 * A priced ride: the breakdown, the price, the commission and what is left for the
 * driver.
 *
 * <p>One record rather than four getters so that the invariant
 * {@code driverNetMinor + commissionMinor == priceMinor} can only ever be produced
 * here, in {@link FareCalculator}, and from then on only be copied.
 *
 * @param surgeBp always {@code 0} in Ф2: the field exists because a quote, a stored
 *                trip and an event all have to carry the multiplier that produced the
 *                price, and adding it later would mean a migration of three tables
 *                for a number that is currently always zero
 * @param commissionBp the platform's cut that produced {@code commissionMinor}, stored
 *                alongside it because the rate is configuration: a receipt printed a
 *                month later must show the rate that was actually applied, not the one
 *                that happens to be configured now
 */
public record FareQuote(FareBreakdown breakdown,
                        long priceMinor,
                        long commissionMinor,
                        long driverNetMinor,
                        int surgeBp,
                        int commissionBp,
                        RouteEstimate route) {
}
