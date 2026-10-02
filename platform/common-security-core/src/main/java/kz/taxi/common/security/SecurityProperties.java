package kz.taxi.common.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.List;

/**
 * Shared security configuration.
 *
 * <p>Local development uses a symmetric HS256 secret so the stack runs with no
 * external identity provider. Production uses an external issuer: the gateway
 * (or a real OIDC provider) signs with a private key, publishes the matching
 * public keys as JWKS, and every service validates against that key set — a
 * service then holds no signing material at all, so a compromised service can
 * no longer mint tokens for itself.
 *
 * <p>The mode is a property ({@code taxi.security.mode}), and {@code HMAC}
 * stays the default: a deployment that only sets {@code jwt-secret} behaves
 * exactly as before.
 *
 * @param jwtSecret          HS256 secret, at least 32 bytes; required in HMAC mode only
 * @param jwtTtl             token lifetime
 * @param issuer             {@code iss} claim used when {@code issuerUri} is absent
 * @param rolesClaim         JWT claim holding role names
 * @param corsAllowedOrigins browser origins allowed to call the API
 * @param publicPaths        paths reachable without a token
 * @param mode               {@link SecurityMode#HMAC} (default) or {@link SecurityMode#JWKS}
 * @param jwkSetUri          JWKS document URL; required in JWKS mode, unused in HMAC mode
 * @param issuerUri          expected {@code iss} value; overrides {@code issuer} for both
 *                           signing and validation when set (an OIDC provider's issuer
 *                           identifier is authoritative, so it wins over the local default)
 * @param jwksCacheTtl       how long a downloaded key set is reused before it is fetched again
 * @param signingKey         RSA private key in PKCS#8 PEM or JWK JSON form — <b>issuer only</b>
 *                           (the gateway). Resource servers must not configure it: a service
 *                           that can sign is a service that can grant itself ADMIN.
 */
@ConfigurationProperties(prefix = "taxi.security")
public record SecurityProperties(
        String jwtSecret,
        Duration jwtTtl,
        String issuer,
        String rolesClaim,
        List<String> corsAllowedOrigins,
        List<String> publicPaths,
        SecurityMode mode,
        String jwkSetUri,
        String issuerUri,
        Duration jwksCacheTtl,
        String signingKey
) {

    /** Default cache lifetime for a downloaded JWK set. */
    public static final Duration DEFAULT_JWKS_CACHE_TTL = Duration.ofMinutes(5);

    public SecurityProperties {
        jwtTtl = jwtTtl == null ? Duration.ofHours(1) : jwtTtl;
        // An issuer is a URL in every OIDC profile; keeping the default URL-shaped
        // avoids a whole class of "claim 'iss' is not a URL" surprises later.
        issuer = issuer == null || issuer.isBlank() ? "https://identity.taxi.local" : issuer;
        rolesClaim = rolesClaim == null || rolesClaim.isBlank() ? "roles" : rolesClaim;
        corsAllowedOrigins = corsAllowedOrigins == null || corsAllowedOrigins.isEmpty()
                ? List.of("http://localhost:5173", "http://127.0.0.1:5173")
                : List.copyOf(corsAllowedOrigins);
        publicPaths = publicPaths == null || publicPaths.isEmpty()
                ? List.of("/actuator/health/**", "/actuator/info", "/actuator/prometheus",
                          "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html", "/error",
                          // Service-to-service endpoints carry no user token: a payment must be
                          // able to credit the *recipient* of a transfer, and the recipient is not
                          // the caller, so that authority cannot be expressed with user roles.
                          // They are authenticated by the internal-token filter, which runs before
                          // this chain and rejects every internal path when no token is configured
                          // — so letting them through the JWT chain grants nothing.
                          //
                          // NOTE: `*` (one segment), not `**`. Spring Security 6 matches with
                          // PathPattern, where `**` must be the last element — a pattern like
                          // /api/v1/**/internal/** fails at request time with PatternParseException.
                          "/api/v1/*/internal/**")
                : List.copyOf(publicPaths);
        // Absent mode means HMAC: that keeps every existing deployment (and every
        // existing test) on the symmetric path without a config change.
        mode = mode == null ? SecurityMode.HMAC : mode;
        jwksCacheTtl = jwksCacheTtl == null || jwksCacheTtl.isZero() || jwksCacheTtl.isNegative()
                ? DEFAULT_JWKS_CACHE_TTL
                : jwksCacheTtl;
    }

    /**
     * Convenience view of the pre-JWKS configuration surface.
     *
     * <p>A static factory rather than an extra constructor on purpose: Spring Boot's
     * {@code @ConfigurationProperties} binding of records only works when the canonical
     * constructor is the only one, and a second constructor makes the application fail
     * to start with "No default constructor found".
     */
    public static SecurityProperties hmac(String jwtSecret,
                                          Duration jwtTtl,
                                          String issuer,
                                          String rolesClaim,
                                          List<String> corsAllowedOrigins,
                                          List<String> publicPaths) {
        return new SecurityProperties(jwtSecret, jwtTtl, issuer, rolesClaim, corsAllowedOrigins, publicPaths,
                SecurityMode.HMAC, null, null, null, null);
    }

    public boolean hasSecret() {
        return jwtSecret != null && !jwtSecret.isBlank();
    }

    public boolean isJwksMode() {
        return mode == SecurityMode.JWKS;
    }

    /**
     * Issuer to write into issued tokens and to require when validating.
     *
     * <p>{@code issuer-uri} wins when present: with an external OIDC provider the
     * discovery document's issuer is the only correct value, and guessing it from
     * the local default would reject every real token.
     */
    public String effectiveIssuer() {
        return issuerUri == null || issuerUri.isBlank() ? issuer : issuerUri;
    }

    /** JWKS URL, or {@code null} when the service runs in HMAC mode. */
    public String requiredJwkSetUri() {
        if (jwkSetUri == null || jwkSetUri.isBlank()) {
            throw new IllegalStateException(
                    "taxi.security.jwk-set-uri must be configured when taxi.security.mode=JWKS");
        }
        return jwkSetUri;
    }
}
