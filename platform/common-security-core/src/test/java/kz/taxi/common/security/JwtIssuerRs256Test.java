package kz.taxi.common.security;

import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import java.security.interfaces.RSAPublicKey;
import java.time.Duration;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * RS256 issuing: what the gateway does once the platform moves off the shared secret.
 */
class JwtIssuerRs256Test {

    private static final String ISSUER = "https://identity.taxi.test";

    private SecurityProperties properties() {
        return new SecurityProperties(null, Duration.ofMinutes(15), ISSUER, "roles", List.of(), List.of(),
                SecurityMode.JWKS, "https://identity.taxi.test/.well-known/jwks.json",
                ISSUER, Duration.ofMinutes(5), null);
    }

    @Test
    @DisplayName("issues an RS256 token that verifies with the public half of the signing key")
    void issues_rs256_token() throws Exception {
        RSAKey key = new RSAKeyGenerator(2048).keyID("gateway-key-1").generate();

        JwtIssuer.IssuedToken token = new JwtIssuer(properties(), key)
                .issue("U-1", "+77001234567", "Aisha", Set.of("MERCHANT"));

        SignedJWT parsed = SignedJWT.parse(token.accessToken());
        assertThat(parsed.getHeader().getAlgorithm().getName()).isEqualTo("RS256");
        assertThat(parsed.verify(new com.nimbusds.jose.crypto.RSASSAVerifier(key.toRSAPublicKey()))).isTrue();

        // A verifier that holds nothing but the public key — the JWKS-mode service.
        Jwt decoded = NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).build().decode(token.accessToken());
        assertThat(decoded.getSubject()).isEqualTo("U-1");
        assertThat(decoded.getClaimAsString("phone")).isEqualTo("+77001234567");
        assertThat(decoded.getIssuer().toString()).isEqualTo(ISSUER);
        assertThat(decoded.getExpiresAt()).isNotNull();
        assertThat(JwtSupport.rolesOf(decoded, "roles")).containsExactly("MERCHANT");
        assertThat(token.expiresInSeconds()).isEqualTo(900);
        assertThat(parsed.getJWTClaimsSet().getJWTID()).hasSize(26);
    }

    @Test
    @DisplayName("derives a stable kid from the key when the JWK carries none")
    void derives_kid_from_thumbprint() throws Exception {
        RSAKey key = new RSAKeyGenerator(2048).generate();
        assertThat(key.getKeyID()).isNull();

        JwtIssuer issuer = new JwtIssuer(properties(), key);

        assertThat(issuer.algorithm().getName()).isEqualTo("RS256");
        assertThat(issuer.keyId()).isEqualTo(key.computeThumbprint().toString());
        SignedJWT parsed = SignedJWT.parse(issuer.issue("U-2", null, null, Set.of()).accessToken());
        assertThat(parsed.getHeader().getKeyID()).isEqualTo(key.computeThumbprint().toString());
    }

    @Test
    @DisplayName("refuses to sign with the public half alone")
    void refuses_public_only_key() throws Exception {
        RSAKey publicOnly = new RSAKeyGenerator(2048).keyID("k").generate().toPublicJWK();

        assertThatThrownBy(() -> new JwtIssuer(properties(), publicOnly))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("private RSA signing key");
    }

    @Test
    @DisplayName("HMAC issuing keeps working and carries no kid")
    void hmac_tokens_have_no_kid() {
        SecurityProperties hmac = SecurityProperties.hmac(
                "unit-test-secret-that-is-long-enough-0123456789", Duration.ofMinutes(15), ISSUER, "roles",
                List.of(), List.of());

        JwtIssuer issuer = new JwtIssuer(hmac);
        String token = issuer.issue("U-3", null, null, Set.of("ADMIN")).accessToken();

        assertThat(issuer.algorithm().getName()).isEqualTo("HS256");
        assertThat(issuer.keyId()).isNull();
        assertThat(JwtSupport.jwtDecoder(hmac.jwtSecret()).decode(token).getSubject()).isEqualTo("U-3");
    }

    @Test
    @DisplayName("the public key of the signing key is what gets published")
    void public_half_is_exportable() throws Exception {
        RSAKey key = new RSAKeyGenerator(2048).keyID("gateway-key-2").generate();

        RSAPublicKey publicKey = key.toPublicJWK().toRSAPublicKey();

        assertThat(publicKey.getModulus()).isEqualTo(key.toRSAPublicKey().getModulus());
    }
}
