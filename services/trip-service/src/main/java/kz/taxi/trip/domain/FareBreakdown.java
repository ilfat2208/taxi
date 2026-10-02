package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;

/**
 * What the rider pays, split into the three parts a receipt shows.
 *
 * <p>All three are minor units (tiyn) and their sum is exactly the trip price. That
 * equality is not decoration: the database enforces
 * {@code driverNetMinor + commissionMinor = priceMinor}, and a breakdown that did not
 * add up to the price would make a support agent unable to explain a charge.
 *
 * <p>The minimum fare is absorbed by {@link #baseMinor} rather than added as a fourth
 * component (see {@link FareCalculator}), which is what keeps the sum honest even on
 * a very short ride.
 */
public record FareBreakdown(long baseMinor, long distanceMinor, long timeMinor) {

    public FareBreakdown {
        if (baseMinor < 0 || distanceMinor < 0 || timeMinor < 0) {
            throw DomainException.of(TripErrorCode.INVALID_FARE,
                            "fare components must not be negative (base={}, distance={}, time={})",
                            baseMinor, distanceMinor, timeMinor)
                    .withDetail("baseMinor", baseMinor)
                    .withDetail("distanceMinor", distanceMinor)
                    .withDetail("timeMinor", timeMinor);
        }
    }

    /** The price before any minimum-fare adjustment — always equal to the charged price. */
    public long totalMinor() {
        return Math.addExact(Math.addExact(baseMinor, distanceMinor), timeMinor);
    }

    public FareBreakdown withBase(long newBaseMinor) {
        return new FareBreakdown(newBaseMinor, distanceMinor, timeMinor);
    }
}
