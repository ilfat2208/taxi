package kz.taxi.common.core.id;

import java.io.Serial;
import java.io.Serializable;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Arrays;
import java.util.Objects;

/**
 * ULID: a lexicographically sortable, 128-bit identifier rendered as 26
 * Crockford base32 characters.
 *
 * <pre>
 *   01J8ZCQ7Y4  R3F0N5G8K2M9QW1T     -> 26 chars
 *   \--------/  \----------------/
 *   48-bit ts      80-bit randomness
 * </pre>
 *
 * <p>Why ULIDs instead of UUIDv4 for a payments platform:
 * <ul>
 *   <li>K-sortable, so {@code ORDER BY id} is chronological — built-in cursor
 *       pagination and index locality on append-only tables (ledger, outbox).</li>
 *   <li>String form is shorter and case-insensitive friendly, which matters for
 *       ids a support agent may read out loud.</li>
 *   <li>Monotonic within the same millisecond, so ids generated in a burst never
 *       collide or sort backwards.</li>
 * </ul>
 */
public final class Ulid implements Comparable<Ulid>, Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    /** Crockford base32: no I, L, O, U — avoids transcription mistakes. */
    private static final char[] ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toCharArray();
    private static final int[] LOOKUP = new int[128];

    private static final int TIME_CHARS = 10;
    private static final int RANDOM_CHARS = 16;
    private static final int RANDOM_BYTES = 10;
    private static final int LENGTH = TIME_CHARS + RANDOM_CHARS;
    private static final long MAX_TIMESTAMP = 0xFFFF_FFFF_FFFFL;

    private static final SecureRandom RANDOM_SOURCE = new SecureRandom();
    private static Ulid lastGenerated;

    static {
        Arrays.fill(LOOKUP, -1);
        for (int i = 0; i < ALPHABET.length; i++) {
            LOOKUP[ALPHABET[i]] = i;
            LOOKUP[Character.toLowerCase(ALPHABET[i])] = i;
        }
        // Crockford decoding aliases: I/L -> 1, O -> 0
        LOOKUP['I'] = 1;
        LOOKUP['i'] = 1;
        LOOKUP['L'] = 1;
        LOOKUP['l'] = 1;
        LOOKUP['O'] = 0;
        LOOKUP['o'] = 0;
    }

    private final long timestamp;
    private final byte[] randomness;

    private Ulid(long timestamp, byte[] randomness) {
        this.timestamp = timestamp;
        this.randomness = randomness.clone();
    }

    // ------------------------------------------------------------------ creation

    /** Generates a new ULID, monotonic within the same millisecond. */
    public static synchronized Ulid generate() {
        long now = System.currentTimeMillis() & MAX_TIMESTAMP;
        byte[] randomness;
        if (lastGenerated != null && lastGenerated.timestamp == now) {
            randomness = increment(lastGenerated.randomness);
            if (randomness == null) {
                now = (now + 1) & MAX_TIMESTAMP;
                randomness = randomBytes();
            }
        } else {
            randomness = randomBytes();
        }
        Ulid ulid = new Ulid(now, randomness);
        lastGenerated = ulid;
        return ulid;
    }

    /** Generates a ULID string, the form used across APIs and Kafka headers. */
    public static String nextId() {
        return generate().toString();
    }

    public static Ulid parse(CharSequence value) {
        Objects.requireNonNull(value, "ulid must not be null");
        String text = value.toString().trim();
        if (text.length() != LENGTH) {
            throw new IllegalArgumentException(
                    "ULID must be exactly %d characters but was %d: %s".formatted(LENGTH, text.length(), text));
        }

        long time = 0L;
        for (int i = 0; i < TIME_CHARS; i++) {
            int digit = decode(text.charAt(i), i);
            time = (time << 5) | digit;
        }
        if (time > MAX_TIMESTAMP) {
            throw new IllegalArgumentException("ULID timestamp overflow: " + text);
        }

        byte[] randomness = new byte[RANDOM_BYTES];
        for (int i = 0; i < RANDOM_CHARS; i++) {
            int digit = decode(text.charAt(TIME_CHARS + i), TIME_CHARS + i);
            for (int bit = 0; bit < 5; bit++) {
                int bitIndex = i * 5 + bit;
                int bitValue = (digit >> (4 - bit)) & 1;
                if (bitValue == 1) {
                    randomness[bitIndex / 8] |= (byte) (1 << (7 - (bitIndex % 8)));
                }
            }
        }
        return new Ulid(time, randomness);
    }

    public static boolean isValid(CharSequence value) {
        if (value == null || value.length() != LENGTH) {
            return false;
        }
        for (int i = 0; i < LENGTH; i++) {
            char c = value.charAt(i);
            if (c >= 128 || LOOKUP[c] < 0) {
                return false;
            }
        }
        return true;
    }

    // ------------------------------------------------------------------ accessors

    public Instant timestamp() {
        return Instant.ofEpochMilli(timestamp);
    }

    public byte[] randomness() {
        return randomness.clone();
    }

    // ------------------------------------------------------------------ encoding

    @Override
    public String toString() {
        char[] out = new char[LENGTH];
        for (int i = TIME_CHARS - 1; i >= 0; i--) {
            out[i] = ALPHABET[(int) ((timestamp >>> (5 * (TIME_CHARS - 1 - i))) & 0x1F)];
        }
        for (int i = 0; i < RANDOM_CHARS; i++) {
            int value = 0;
            for (int bit = 0; bit < 5; bit++) {
                int bitIndex = i * 5 + bit;
                int current = (randomness[bitIndex / 8] >> (7 - (bitIndex % 8))) & 1;
                value = (value << 1) | current;
            }
            out[TIME_CHARS + i] = ALPHABET[value];
        }
        return new String(out);
    }

    @Override
    public int compareTo(Ulid other) {
        int byTime = Long.compare(timestamp, other.timestamp);
        if (byTime != 0) {
            return byTime;
        }
        return Arrays.compareUnsigned(randomness, other.randomness);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Ulid other)) {
            return false;
        }
        return timestamp == other.timestamp && Arrays.equals(randomness, other.randomness);
    }

    @Override
    public int hashCode() {
        return 31 * Long.hashCode(timestamp) + Arrays.hashCode(randomness);
    }

    // ------------------------------------------------------------------ internals

    private static byte[] randomBytes() {
        byte[] bytes = new byte[RANDOM_BYTES];
        RANDOM_SOURCE.nextBytes(bytes);
        return bytes;
    }

    /** Big-endian increment, or {@code null} on overflow. */
    private static byte[] increment(byte[] source) {
        byte[] next = source.clone();
        for (int i = next.length - 1; i >= 0; i--) {
            if (++next[i] != 0) {
                return next;
            }
        }
        return null;
    }

    private static int decode(char c, int position) {
        if (c >= 128 || LOOKUP[c] < 0) {
            throw new IllegalArgumentException("invalid ULID character '%s' at position %d".formatted(c, position));
        }
        return LOOKUP[c];
    }
}
