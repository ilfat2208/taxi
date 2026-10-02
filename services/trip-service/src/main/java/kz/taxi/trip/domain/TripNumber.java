package kz.taxi.trip.domain;

import kz.taxi.common.core.id.Ulid;

/**
 * Human-readable trip number: {@code "T"} + the 26-character ULID of the trip.
 *
 * <p>The same choice payment-service made for its numbers, for the same reasons: a
 * database sequence would be a contention point on the write path of the busiest
 * table in the service and would publish the platform's nightly volume to anybody
 * who sees two trip numbers; the raw ULID would be indistinguishable from an account
 * or a payment id when support reads it out loud. The {@code T} prefix is enough to
 * tell a customer which number he is holding.
 */
public final class TripNumber {

    public static final String PREFIX = "T";

    /** {@code trip.trip.trip_number} is {@code VARCHAR(32)}; 1 + 26 leaves room. */
    public static final int MAX_LENGTH = 32;

    private TripNumber() {
    }

    public static String next() {
        return PREFIX + Ulid.nextId();
    }

    public static boolean isValid(String tripNumber) {
        return tripNumber != null
                && tripNumber.length() == PREFIX.length() + 26
                && tripNumber.startsWith(PREFIX);
    }
}
