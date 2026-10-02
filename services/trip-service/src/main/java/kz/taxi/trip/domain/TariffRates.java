package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;

/**
 * The price list of one tariff, in minor units.
 *
 * <p>Integers, like every amount on this platform: a per-kilometre rate of
 * {@code 12 000} tiyn is exact, while {@code 120.0} tenge is a rounding argument
 * waiting to happen on a 3.5 km ride.
 *
 * @param baseMinor    what the rider pays for getting in, before distance and time
 * @param perKmMinor   price of one kilometre
 * @param perMinuteMinor  price of one started minute
 * @param minFareMinor the floor of a ride: a 400-metre trip still costs a car and a
 *                     driver, and charging the arithmetic result of it would lose
 *                     the platform money on every short hop
 */
public record TariffRates(long baseMinor, long perKmMinor, long perMinuteMinor, long minFareMinor) {

    public TariffRates {
        if (baseMinor < 0 || perKmMinor < 0 || perMinuteMinor < 0) {
            throw DomainException.of(TripErrorCode.INVALID_FARE,
                            "tariff rates must not be negative (base={}, perKm={}, perMin={})",
                            baseMinor, perKmMinor, perMinuteMinor)
                    .withDetail("baseMinor", baseMinor)
                    .withDetail("perKmMinor", perKmMinor)
                    .withDetail("perMinuteMinor", perMinuteMinor);
        }
        if (minFareMinor < 0) {
            throw DomainException.of(TripErrorCode.INVALID_FARE,
                            "minimum fare must not be negative ({})", minFareMinor)
                    .withDetail("minFareMinor", minFareMinor);
        }
    }

    /** True when the entry cannot produce a sensible price and must not reach a rider. */
    public boolean isComplete() {
        return baseMinor > 0 && minFareMinor > 0;
    }
}
