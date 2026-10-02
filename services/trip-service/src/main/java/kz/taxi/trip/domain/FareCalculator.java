package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;

import java.util.EnumMap;
import java.util.Map;

/**
 * Prices a ride.
 *
 * <p>The formula is the one on the tariff card, and it is integer arithmetic end to
 * end — no {@code double} ever touches an amount that a rider is charged:
 *
 * <pre>
 *   distanceMinor = perKmMinor  x metres / 1000      (rounded half up)
 *   timeMinor     = perMinuteMinor x started minutes
 *   baseMinor     = max(configuredBase, minFare - distanceMinor - timeMinor)
 *   priceMinor    = baseMinor + distanceMinor + timeMinor
 *   commission    = round(priceMinor x commissionBp / 10 000)
 *   driverNet     = priceMinor - commission            &lt;- the invariant, by subtraction
 * </pre>
 *
 * <p>Four decisions are worth stating, because each of them is a place where money
 * could quietly go missing:
 *
 * <ul>
 *   <li><b>The minimum fare is absorbed by the base component.</b> The obvious
 *       implementation — {@code price = max(sum, minFare)} — produces a price that
 *       the breakdown does not add up to, and this service stores and enforces
 *       {@code driverNet + commission = price} in the database. Raising the base to
 *       cover the shortfall keeps a short ride priced at the minimum <em>and</em>
 *       keeps the receipt arithmetic true.</li>
 *   <li><b>Commission is rounded half up, and the driver gets the rest.</b> The
 *       platform never takes a tiyn more than its basis points, and the sum is exact
 *       because the two numbers are derived from each other rather than computed
 *       independently.</li>
 *   <li><b>A started minute is charged.</b> Otherwise a 59-second wait is free and the
 *       fare is trivially gamed by stopping just before the minute rolls over.</li>
 *   <li><b>A price of zero is refused.</b> An account hold of zero is rejected by the
 *       account service, and "the ride is free because the tariff was misconfigured"
 *       is not a failure a rider should ever be able to observe.</li>
 * </ul>
 *
 * <p>Surge is not implemented in Ф2: {@link FareQuote#surgeBp()} is always zero and
 * exists so the multiplier that produced a stored price is part of the record.
 */
public final class FareCalculator {

    /** Basis points in a whole: 12% is {@code 1200}. */
    public static final int BASIS_POINTS = 10_000;

    private final Map<Tariff, TariffRates> rates;
    private final int commissionBp;

    public FareCalculator(Map<Tariff, TariffRates> rates, int commissionBp) {
        if (rates == null || rates.isEmpty()) {
            throw new IllegalArgumentException("at least one tariff must be configured");
        }
        if (commissionBp < 0 || commissionBp >= BASIS_POINTS) {
            throw new IllegalArgumentException(
                    "commissionBp must be within [0, 10000) but was " + commissionBp);
        }
        this.rates = new EnumMap<>(rates);
        this.commissionBp = commissionBp;
    }

    /** The rates behind a tariff — read by the quote API to explain a price. */
    public TariffRates ratesFor(Tariff tariff) {
        TariffRates found = rates.get(tariff);
        if (found == null) {
            throw DomainException.of(TripErrorCode.INVALID_TARIFF,
                            "tariff {} has no rates configured", tariff)
                    .withDetail("tariff", tariff == null ? null : tariff.name());
        }
        return found;
    }

    /** Prices one estimated ride on one tariff. */
    public FareQuote quote(Tariff tariff, RouteEstimate route) {
        TariffRates tariffRates = ratesFor(tariff);

        // Integer half-up: multiplyExact would throw on an overflow rather than
        // silently wrapping, and a wrap here would be a price near zero.
        long distanceMinor = Math.addExact(Math.multiplyExact(tariffRates.perKmMinor(), (long) route.distanceM()), 500L)
                / 1000L;
        // A started minute is charged: (seconds + 59) / 60 is ceil without a float.
        long minutes = (route.durationS() + 59L) / 60L;
        long timeMinor = Math.multiplyExact(tariffRates.perMinuteMinor(), minutes);

        long minimumTopUp = tariffRates.minFareMinor() - distanceMinor - timeMinor;
        long baseMinor = Math.max(tariffRates.baseMinor(), minimumTopUp);
        FareBreakdown breakdown = new FareBreakdown(baseMinor, distanceMinor, timeMinor);

        long priceMinor = breakdown.totalMinor();
        if (priceMinor <= 0L) {
            throw DomainException.of(TripErrorCode.INVALID_FARE,
                            "tariff {} prices this ride at {} — check taxi.trip.tariffs", tariff, priceMinor)
                    .withDetail("tariff", tariff == null ? null : tariff.name())
                    .withDetail("priceMinor", priceMinor);
        }

        long commissionMinor = Math.addExact(Math.multiplyExact(priceMinor, (long) commissionBp), BASIS_POINTS / 2L)
                / BASIS_POINTS;
        // By subtraction, not by a second rounding: this is what makes
        // driverNet + commission == price true by construction, and the database
        // CHECK only has to agree with the code, never fix it.
        long driverNetMinor = priceMinor - commissionMinor;

        return new FareQuote(breakdown, priceMinor, commissionMinor, driverNetMinor, 0, commissionBp, route);
    }

    public int commissionBp() {
        return commissionBp;
    }
}
