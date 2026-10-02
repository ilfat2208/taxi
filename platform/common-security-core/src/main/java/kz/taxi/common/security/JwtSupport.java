package kz.taxi.common.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.DefaultJWKSetCache;
import com.nimbusds.jose.jwk.source.JWKSetCache;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * JWT wiring shared by every service.
 *
 * <p>Two validation modes, selected by {@code taxi.security.mode}:
 * <ul>
 *   <li>{@link #jwtDecoder(String)} — symmetric HS256 with a shared secret. This is
 *       the local-development default and stays byte-for-byte the same as before, so
 *       switching the platform to asymmetric tokens cannot change existing behaviour;</li>
 *   <li>{@link #jwksDecoder(String, String)} — asymmetric RS256 verified against the
 *       issuer's public JSON Web Key Set. The service holds no signing material: the
 *       private key never leaves the issuer.</li>
 * </ul>
 *
 * <p>The role mapping and principal model ({@link #authenticationConverter(String)},
 * {@link AuthenticatedUser}) are identical in both modes: business code never learns
 * which algorithm signed the token, which is exactly what allows one deployment to
 * move while the rest of the platform keeps running.
 */
public final class JwtSupport {

    /** HS256 requires a key of at least 256 bits. */
    public static final int MIN_SECRET_BYTES = 32;

    /** How long a downloaded JWK set is reused; see the caching notes on {@link #jwksDecoder}. */
    public static final Duration DEFAULT_JWKS_CACHE_TTL = SecurityProperties.DEFAULT_JWKS_CACHE_TTL;

    /** Start the refresh this long before the cached key set expires. */
    public static final Duration JWKS_REFRESH_AHEAD = Duration.ofSeconds(30);

    private static final int JWKS_CONNECT_TIMEOUT_MS = 2_000;
    private static final int JWKS_READ_TIMEOUT_MS = 5_000;
    /** Bounded so a hostile or broken JWKS URL cannot make a service read forever. */
    private static final int JWKS_MAX_BYTES = 256 * 1024;

    private JwtSupport() {
    }

    public static SecretKey secretKey(String rawSecret) {
        if (rawSecret == null || rawSecret.isBlank()) {
            throw new IllegalStateException("taxi.security.jwt-secret must be configured");
        }
        byte[] bytes = rawSecret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "taxi.security.jwt-secret must be at least %d bytes for HS256 but was %d"
                            .formatted(MIN_SECRET_BYTES, bytes.length));
        }
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    /** HMAC (HS256) decoder: the symmetric mode, unchanged from the platform's first version. */
    public static JwtDecoder jwtDecoder(String rawSecret) {
        return NimbusJwtDecoder.withSecretKey(secretKey(rawSecret))
                .macAlgorithm(org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256)
                .build();
    }

    /** JWKS decoder with the default cache lifetime ({@value #DEFAULT_JWKS_CACHE_TTL}). */
    public static JwtDecoder jwksDecoder(String jwkSetUri, String issuer) {
        return jwksDecoder(jwkSetUri, issuer, DEFAULT_JWKS_CACHE_TTL);
    }

    /**
     * Asymmetric decoder: verifies RS256 tokens against the issuer's published key set.
     *
     * <p>Only {@code RS256} is accepted. This is deliberate and is the defence against
     * the classic JWT attacks:
     * <ul>
     *   <li>{@code alg=none} — an unsigned token is not a {@code SignedJWT} at all and is
     *       rejected by the processor before any key is consulted;</li>
     *   <li>algorithm confusion — an HS256 token sent to a JWKS service would tempt a naive
     *       verifier into using the *public* key as an HMAC secret. The key selector is
     *       pinned to RS256, so an HS256 header never reaches a key: it is rejected.</li>
     * </ul>
     *
     * <h2>Caching and key rotation</h2>
     * The key set is downloaded once and then reused for {@code cacheTtl} (default
     * {@value #DEFAULT_JWKS_CACHE_TTL}). Fetching it per request would put the identity
     * provider on the hot path of every API call and turn it into a platform-wide single
     * point of failure; the cache is what makes local validation actually local.
     *
     * <p>A refresh happens when:
     * <ul>
     *   <li>the cache is empty (first request after startup);</li>
     *   <li>the cached set is older than the TTL — the download starts
     *       {@value #JWKS_REFRESH_AHEAD} before expiry (refresh-ahead), so the expiry
     *       itself is never observed as a latency spike;</li>
     *   <li>a token arrives with a {@code kid} that the cached set does not contain — the
     *       set is fetched again immediately, once, and only for a genuinely unknown key
     *       id. A {@code kid} that *is* present but fails to match (wrong algorithm, wrong
     *       use) is rejected without any network call. This is what makes rotation work
     *       without restarts: the issuer publishes the new public key first, starts signing
     *       with the new {@code kid}, and every service picks it up on the first token that
     *       carries it. The old key must stay in the published set until every token signed
     *       with it has expired, otherwise those tokens start failing.</li>
     * </ul>
     * Concurrent refreshes are serialized inside nimbus, so a burst of requests right after
     * a rotation costs one download rather than one per request. If the refreshed set still
     * does not contain the {@code kid}, the token is rejected — it is never accepted "for
     * now". The flip side of that rule is worth knowing: a caller who can send tokens with
     * random key ids makes the service re-fetch the JWKS URL on every such request, so the
     * JWKS endpoint must be served with HTTP caching (the gateway sends {@code Cache-Control})
     * and must stay cheap.
     *
     * <p>When {@code issuer} is not blank the {@code iss} claim is validated too: accepting
     * any issuer that happens to hold a key would let a second, weaker issuer mint tokens
     * for this platform.
     *
     * @param jwkSetUri key set URL, e.g. {@code http://api-gateway:8080/.well-known/jwks.json}
     * @param issuer    expected {@code iss} claim, or {@code null}/blank to skip issuer validation
     * @param cacheTtl  cache lifetime; {@code null} or a non-positive value means the default
     */
    public static JwtDecoder jwksDecoder(String jwkSetUri, String issuer, Duration cacheTtl) {
        if (jwkSetUri == null || jwkSetUri.isBlank()) {
            throw new IllegalStateException(
                    "taxi.security.jwk-set-uri must be configured when taxi.security.mode=JWKS");
        }
        Duration ttl = cacheTtl == null || cacheTtl.isZero() || cacheTtl.isNegative()
                ? DEFAULT_JWKS_CACHE_TTL
                : cacheTtl;

        // Nimbus keeps the downloaded set in this cache and reuses it across requests;
        // `RemoteJWKSet` implements the rotation behaviour described above.
        JWKSetCache cache = new DefaultJWKSetCache(
                ttl.toMillis(), JWKS_REFRESH_AHEAD.toMillis(), TimeUnit.MILLISECONDS);
        JWKSource<SecurityContext> jwkSource;
        try {
            jwkSource = new RemoteJWKSet<>(new URL(jwkSetUri),
                    new DefaultResourceRetriever(JWKS_CONNECT_TIMEOUT_MS, JWKS_READ_TIMEOUT_MS, JWKS_MAX_BYTES),
                    cache);
        } catch (MalformedURLException ex) {
            throw new IllegalStateException(
                    "taxi.security.jwk-set-uri is not a valid URL: " + jwkSetUri, ex);
        }

        DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource));

        NimbusJwtDecoder decoder = new NimbusJwtDecoder(processor);
        decoder.setJwtValidator(validatorsFor(issuer));
        return decoder;
    }

    /**
     * Token validators for a JWKS decoder: expiry/not-before, plus issuer when known.
     *
     * <p>Kept as its own method so the exact set of checks is visible in one place — the
     * signature algorithm is enforced by the key selector, not here.
     */
    private static OAuth2TokenValidator<Jwt> validatorsFor(String issuer) {
        return issuer == null || issuer.isBlank()
                ? JwtValidators.createDefault()
                : JwtValidators.createDefaultWithIssuer(issuer);
    }

    /**
     * Maps the {@code roles} claim to Spring Security authorities.
     *
     * <p>Roles (who you are) are kept separate from scopes (what a client may
     * ask for), so a service can express {@code hasRole('MERCHANT')} without
     * caring which OAuth client obtained the token.
     */
    public static Converter<Jwt, AbstractAuthenticationToken> authenticationConverter(String rolesClaim) {
        JwtGrantedAuthoritiesConverter authorities = new JwtGrantedAuthoritiesConverter();
        authorities.setAuthoritiesClaimName(rolesClaim);
        authorities.setAuthorityPrefix(Roles.PREFIX);

        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        converter.setPrincipalClaimName("sub");
        return converter;
    }

    public static Set<String> rolesOf(Jwt jwt, String rolesClaim) {
        Object claim = jwt.getClaim(rolesClaim);
        Set<String> roles = new LinkedHashSet<>();
        if (claim instanceof Collection<?> collection) {
            collection.forEach(value -> {
                if (value != null) {
                    roles.add(String.valueOf(value).toUpperCase());
                }
            });
        } else if (claim instanceof String text && !text.isBlank()) {
            for (String part : text.split("[,\\s]+")) {
                if (!part.isBlank()) {
                    roles.add(part.toUpperCase());
                }
            }
        }
        return Set.copyOf(roles);
    }
}
