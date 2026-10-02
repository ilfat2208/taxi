package kz.taxi.qtime.domain;

/**
 * The code a client reads out loud: {@code QT-8F3K2M9P}.
 *
 * <p>Why a second identifier next to the ULID: an id is a technical key nobody can
 * pronounce (and one that leaks when a booking was made), while a support call is
 * "назовите код записи". The code is short enough to dictate and long enough not to
 * be guessable in bulk — 8 characters of the 32-symbol alphabet, 40 bits.
 *
 * <p>Derived from the booking's ULID rather than drawn from a generator of its own:
 * the same booking always yields the same code, no extra state is needed to keep
 * them in step, and the ULID's randomness is already secure. A collision would be a
 * one-in-a-trillion event that the {@code booking_code_unique} index turns into a
 * failed insert rather than into two bookings sharing a code.
 *
 * <p>The alphabet is Crockford base32 — the same one ULIDs use — so {@code 0/O} and
 * {@code 1/I/L} cannot be confused on a phone call.
 */
public final class BookingCode {

    public static final String PREFIX = "QT-";

    private static final int BODY_LENGTH = 8;
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    private BookingCode() {
    }

    /** Builds the code of a booking from its ULID. */
    public static String of(String bookingId) {
        if (bookingId == null || bookingId.length() < BODY_LENGTH) {
            throw new IllegalArgumentException("a booking id must be at least 8 characters long");
        }
        // The random half of a ULID is already base32 over this alphabet, so the last
        // eight characters are a valid, uniformly distributed body.
        return PREFIX + bookingId.substring(bookingId.length() - BODY_LENGTH).toUpperCase();
    }

    /** True when the text looks like a code this class could have produced. */
    public static boolean isValid(String code) {
        if (code == null || !code.startsWith(PREFIX) || code.length() != PREFIX.length() + BODY_LENGTH) {
            return false;
        }
        for (int i = PREFIX.length(); i < code.length(); i++) {
            if (ALPHABET.indexOf(code.charAt(i)) < 0) {
                return false;
            }
        }
        return true;
    }
}
