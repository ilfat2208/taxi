package kz.taxi.common.security;

/**
 * How a service verifies access tokens.
 *
 * <p>{@link #HMAC} is the local-development mode: one shared secret signs and
 * verifies (HS256), which means every service that can validate a token can
 * also mint one. {@link #JWKS} is the production posture: an asymmetric issuer
 * signs (RS256) with a private key it never shares, and services only ever hold
 * the public key set they download from {@code /.well-known/jwks.json}.
 *
 * <p>The switch is a property, not a code change, so the same artifact runs in
 * both modes and a service can be migrated one deployment at a time.
 */
public enum SecurityMode {

    /** Symmetric HS256 with {@code taxi.security.jwt-secret}. */
    HMAC,

    /** Asymmetric RS256 verified against {@code taxi.security.jwk-set-uri}. */
    JWKS
}
