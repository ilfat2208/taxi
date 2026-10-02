package kz.taxi.common.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Configuration surface: the old shape must keep meaning what it always meant.
 */
class SecurityPropertiesTest {

    private static final String SECRET = "unit-test-secret-that-is-long-enough-0123456789";

    @Test
    @DisplayName("a service that configures only jwt-secret stays on HMAC with identical defaults")
    void legacy_configuration_is_hmac() {
        SecurityProperties properties = SecurityProperties.hmac(SECRET, null, null, null, null, null);

        assertThat(properties.mode()).isEqualTo(SecurityMode.HMAC);
        assertThat(properties.isJwksMode()).isFalse();
        assertThat(properties.hasSecret()).isTrue();
        assertThat(properties.jwtTtl()).isEqualTo(Duration.ofHours(1));
        assertThat(properties.effectiveIssuer()).isEqualTo("https://identity.taxi.local");
        assertThat(properties.jwkSetUri()).isNull();
        assertThat(properties.signingKey()).isNull();
    }

    @Test
    @DisplayName("a missing mode defaults to HMAC rather than to a mode that needs new settings")
    void missing_mode_defaults_to_hmac() {
        SecurityProperties properties = properties(null, null, null);

        assertThat(properties.mode()).isEqualTo(SecurityMode.HMAC);
    }

    @Test
    @DisplayName("JWKS mode needs a key set URL, and a service in it needs no secret")
    void jwks_mode_requires_only_the_key_set_uri() {
        SecurityProperties properties = properties(SecurityMode.JWKS,
                "https://issuer.test/.well-known/jwks.json", null);

        assertThat(properties.hasSecret()).isFalse();
        assertThat(properties.requiredJwkSetUri()).isEqualTo("https://issuer.test/.well-known/jwks.json");
    }

    @Test
    @DisplayName("JWKS mode without a URL fails fast instead of starting up unprotected")
    void jwks_mode_without_uri_fails() {
        SecurityProperties properties = properties(SecurityMode.JWKS, "  ", null);

        assertThatThrownBy(properties::requiredJwkSetUri)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("jwk-set-uri");
    }

    @Test
    @DisplayName("issuer-uri overrides the local issuer default when an OIDC provider is used")
    void issuer_uri_wins_over_issuer() {
        assertThat(withIssuer("https://legacy.test", "https://issuer.test").effectiveIssuer())
                .isEqualTo("https://issuer.test");
        assertThat(withIssuer("https://legacy.test", "  ").effectiveIssuer())
                .isEqualTo("https://legacy.test");
        assertThat(withIssuer(null, null).effectiveIssuer())
                .isEqualTo("https://identity.taxi.local");
    }

    @Test
    @DisplayName("the JWKS cache lifetime is always a positive duration")
    void jwks_cache_ttl_defaults() {
        assertThat(properties(SecurityMode.JWKS, "https://issuer.test/jwks", null).jwksCacheTtl())
                .isEqualTo(SecurityProperties.DEFAULT_JWKS_CACHE_TTL);
        assertThat(properties(SecurityMode.JWKS, "https://issuer.test/jwks", Duration.ZERO).jwksCacheTtl())
                .isEqualTo(SecurityProperties.DEFAULT_JWKS_CACHE_TTL);
        assertThat(properties(SecurityMode.JWKS, "https://issuer.test/jwks", Duration.ofSeconds(45)).jwksCacheTtl())
                .isEqualTo(Duration.ofSeconds(45));
    }

    private static SecurityProperties properties(SecurityMode mode, String jwkSetUri, Duration cacheTtl) {
        // A JWKS deployment has no secret at all: that is the whole point of the mode.
        String secret = mode == SecurityMode.JWKS ? null : SECRET;
        return new SecurityProperties(secret, Duration.ofMinutes(15), null, "roles", List.of(), List.of(),
                mode, jwkSetUri, null, cacheTtl, null);
    }

    private static SecurityProperties withIssuer(String issuer, String issuerUri) {
        return new SecurityProperties(SECRET, Duration.ofMinutes(15), issuer, "roles", List.of(), List.of(),
                SecurityMode.JWKS, "https://identity.taxi.test/.well-known/jwks.json",
                issuerUri, Duration.ofMinutes(5), null);
    }
}
