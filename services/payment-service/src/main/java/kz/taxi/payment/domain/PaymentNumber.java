package kz.taxi.payment.domain;

import kz.taxi.common.core.id.Ulid;

/**
 * Human-readable payment number: {@code "P"} + the 26-character ULID of the payment.
 *
 * <p>Why not a database sequence: a sequence is a single point of contention on
 * the hottest write path of the service and it publishes the platform's volume to
 * anyone who sees two payment numbers. Why not the raw ULID: support reads these
 * numbers to customers over the phone, and a leading {@code P} makes it obvious
 * that the string is a payment and not an account or an order.
 *
 * <p>The ULID suffix keeps the useful part of a sequence: it is unique without a
 * round trip, it is time-sortable (the first characters are the timestamp), and
 * two replicas cannot collide.
 */
public final class PaymentNumber {

    public static final String PREFIX = "P";

    /** {@code payment.payment_number} is {@code VARCHAR(32)}; 1 + 26 leaves room. */
    public static final int MAX_LENGTH = 32;

    private PaymentNumber() {
    }

    public static String next() {
        return PREFIX + Ulid.nextId();
    }

    public static boolean isValid(String paymentNumber) {
        if (paymentNumber == null || paymentNumber.length() != PREFIX.length() + 26) {
            return false;
        }
        return paymentNumber.startsWith(PREFIX);
    }
}
