package kz.taxi.payment.domain;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Objects;

/**
 * SHA-256 of the canonical request JSON, stored in {@code payment.request_hash}.
 *
 * <p>The idempotency store already compares request bodies, but that comparison
 * lives in Redis and expires: the column is what still answers "was this key used
 * for this body?" when the store has forgotten. It is the same digest the
 * platform's {@code IdempotencyGuard} computes, so the two agree.
 */
public record RequestHash(String value) {

    private static final int LENGTH = 64;

    public RequestHash {
        Objects.requireNonNull(value, "requestHash must not be null");
        if (value.length() != LENGTH) {
            throw new IllegalArgumentException("request hash must be a 64-character SHA-256 hex string");
        }
    }

    /** Hashes a canonical JSON body (or any stable representation of the request). */
    public static RequestHash of(String canonicalJson) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest((canonicalJson == null ? "null" : canonicalJson)
                    .getBytes(StandardCharsets.UTF_8));
            return new RequestHash(HexFormat.of().formatHex(hash));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required by the JVM", ex);
        }
    }

    @Override
    public String toString() {
        return value;
    }
}
