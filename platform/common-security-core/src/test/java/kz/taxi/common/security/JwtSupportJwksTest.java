package kz.taxi.common.security;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.jwk.JWK;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The asymmetric path: RS256 tokens verified against a JWKS document.
 *
 * <p>Every rejection here is an attack that is known to work against naive JWT
 * implementations, so the tests name the trick rather than the mechanism.
 */
class JwtSupportJwksTest {

    private static final String ISSUER = "https://identity.taxi.test";
    private static final String SECRET = "unit-test-secret-that-is-long-enough-0123456789";

    private static RSAKey issuerKey;
    private JwksTestServer server;

    @BeforeAll
    static void generateIssuerKey() throws Exception {
        // RSA key generation is the slow part of this suite, and no test depends on the
        // key material being fresh — one key per class is enough.
        issuerKey = new RSAKeyGenerator(2048).keyID("issuer-key-1").generate();
    }

    @BeforeEach
    void startServer() {
        server = JwksTestServer.start(new JWKSet(issuerKey.toPublicJWK()));
    }

    @AfterEach
    void tearDown() {
        server.close();
    }

    private SecurityProperties properties() {
        return new SecurityProperties(SECRET, Duration.ofMinutes(15), ISSUER, "roles",
                List.of(), List.of(), SecurityMode.JWKS, server.url(), ISSUER,
                Duration.ofMinutes(5), null);
    }

    private JwtDecoder decoder() {
        return JwtSupport.jwksDecoder(server.url(), ISSUER);
    }

    private String issue(RSAKey key, Set<String> roles) {
        return new JwtIssuer(properties(), key).issue("U-1", "+77001234567", "Aisha", roles).accessToken();
    }

    @Test
    @DisplayName("a token signed by the issuer key validates against the JWKS document of that same key")
    void accepts_token_signed_by_the_published_key() {
        String token = issue(issuerKey, Set.of("CUSTOMER"));

        Jwt decoded = decoder().decode(token);

        assertThat(decoded.getSubject()).isEqualTo("U-1");
        assertThat(decoded.getIssuer().toString()).isEqualTo(ISSUER);
        assertThat(decoded.getClaimAsString("phone")).isEqualTo("+77001234567");
        assertThat(JwtSupport.rolesOf(decoded, "roles")).containsExactly("CUSTOMER");
        assertThat(decoded.getHeaders().get("alg")).isEqualTo("RS256");
    }

    @Test
    @DisplayName("the JOSE header names the key that signed the token")
    void publishes_kid_in_the_header() {
        String token = issue(issuerKey, Set.of("CUSTOMER"));

        Jwt decoded = decoder().decode(token);

        // The kid is what lets the verifier pick the right key out of a rotating set.
        assertThat(decoded.getHeaders().get("kid")).isEqualTo("issuer-key-1");
    }

    @Test
    @DisplayName("a token signed by a different RSA key is rejected")
    void rejects_token_signed_by_another_key() throws Exception {
        RSAKey rogue = new RSAKeyGenerator(2048).keyID("rogue-key").generate();

        String token = issue(rogue, Set.of("ADMIN"));

        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    @DisplayName("an attacker cannot borrow the published kid for a key of their own")
    void rejects_foreign_key_reusing_the_published_kid() throws Exception {
        // Same kid, different key material: the key id is a hint, never proof.
        RSAKey impostor = new RSAKeyGenerator(2048).keyID("issuer-key-1").generate();

        String token = issue(impostor, Set.of("ADMIN"));

        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    @DisplayName("an unknown kid is rejected, not accepted on trust")
    void rejects_unknown_kid() throws Exception {
        String token = signedWithUnknownKid();

        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class);
        // Two fetches: the initial download, then the refresh the unknown kid forced.
        // The token is still refused — "unknown kid" means re-read the key set, never
        // "accept what we cannot verify".
        assertThat(server.requests()).isEqualTo(2);
    }

    @Test
    @DisplayName("alg=none is rejected")
    void rejects_alg_none() {
        PlainJWT unsigned = new PlainJWT(claims(ISSUER));

        assertThatThrownBy(() -> decoder().decode(unsigned.serialize()))
                .isInstanceOf(JwtException.class);
    }

    @Test
    @DisplayName("algorithm confusion: an HS256 token signed with the public key is rejected")
    void rejects_hs256_token_on_a_jwks_service() throws Exception {
        // The classic attack: the verifier is tricked into using the *public* key as an
        // HMAC secret. Here the attacker signs with exactly those public bytes.
        byte[] publicKeyBytes = issuerKey.toRSAPublicKey().getEncoded();
        SignedJWT forged = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.HS256).keyID("issuer-key-1").build(),
                claims(ISSUER));
        forged.sign(new MACSigner(publicKeyBytes));

        assertThatThrownBy(() -> decoder().decode(forged.serialize()))
                .isInstanceOf(JwtException.class);
    }

    @Test
    @DisplayName("an HS256 token signed with the shared secret is also rejected")
    void rejects_hs256_token_signed_with_the_shared_secret() {
        String token = new JwtIssuer(SecurityProperties.hmac(SECRET, Duration.ofMinutes(15),
                ISSUER, "roles", List.of(), List.of())).issue("U-1", null, null, Set.of("ADMIN")).accessToken();

        assertThatThrownBy(() -> decoder().decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    @DisplayName("the key set is fetched once, not once per request")
    void caches_the_key_set() {
        JwtDecoder decoder = decoder();
        String token = issue(issuerKey, Set.of("CUSTOMER"));

        for (int i = 0; i < 5; i++) {
            assertThat(decoder.decode(token).getSubject()).isEqualTo("U-1");
        }

        assertThat(server.requests()).isEqualTo(1);
    }

    @Test
    @DisplayName("a rotated key is picked up without a restart, and old tokens keep working")
    void picks_up_a_rotated_key() throws Exception {
        JwtDecoder decoder = decoder();
        String beforeRotation = issue(issuerKey, Set.of("CUSTOMER"));
        assertThat(decoder.decode(beforeRotation).getSubject()).isEqualTo("U-1");
        assertThat(server.requests()).isEqualTo(1);

        // The issuer publishes the new key next to the old one and starts signing with it.
        RSAKey rotated = new RSAKeyGenerator(2048).keyID("issuer-key-2").generate();
        server.serve(new JWKSet(List.<JWK>of(rotated.toPublicJWK(), issuerKey.toPublicJWK())));
        String afterRotation = issue(rotated, Set.of("CUSTOMER"));

        assertThat(decoder.decode(afterRotation).getSubject()).isEqualTo("U-1");
        // Exactly one extra fetch: the unknown kid forced a refresh, and nothing else did.
        assertThat(server.requests()).isEqualTo(2);
        // Tokens signed with the previous key stay valid while that key is still published,
        // which is what makes a rotation invisible to clients holding live tokens.
        assertThat(decoder.decode(beforeRotation).getSubject()).isEqualTo("U-1");
        assertThat(server.requests()).isEqualTo(2);
    }

    @Test
    @DisplayName("a token from another issuer is rejected even when the signature is valid")
    void rejects_token_from_another_issuer() {
        SecurityProperties otherIssuer = new SecurityProperties(SECRET, Duration.ofMinutes(15),
                "https://identity.attacker.test", "roles", List.of(), List.of(),
                SecurityMode.JWKS, server.url(), null, null, null);
        String token = new JwtIssuer(otherIssuer, issuerKey).issue("U-1", null, null, Set.of("ADMIN")).accessToken();

        assertThatThrownBy(() -> decoder().decode(token))
                .isInstanceOf(JwtException.class)
                .hasMessageContaining("iss");
    }

    @Test
    @DisplayName("JWKS mode without a key set URL fails loudly instead of accepting anything")
    void requires_jwk_set_uri() {
        assertThatThrownBy(() -> JwtSupport.jwksDecoder(" ", ISSUER))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("jwk-set-uri");
    }

    @Test
    @DisplayName("rolls over to a brand-new key set once the old one is gone")
    void accepts_a_completely_new_key_set() throws Exception {
        JwtDecoder decoder = decoder();
        assertThat(decoder.decode(issue(issuerKey, Set.of("CUSTOMER"))).getSubject()).isEqualTo("U-1");

        RSAKey next = new RSAKeyGenerator(2048).keyID("issuer-key-9").generate();
        server.serve(new JWKSet(next.toPublicJWK()));

        assertThat(decoder.decode(issue(next, Set.of("CUSTOMER"))).getSubject()).isEqualTo("U-1");
    }

    private String signedWithUnknownKid() throws Exception {
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("kid-that-was-never-published").build(),
                claims(ISSUER));
        jwt.sign(new com.nimbusds.jose.crypto.RSASSASigner(issuerKey));
        return jwt.serialize();
    }

    private static JWTClaimsSet claims(String issuer) {
        Instant now = Instant.now();
        return new JWTClaimsSet.Builder()
                .issuer(issuer)
                .subject("U-1")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300)))
                .claim("roles", List.of("ADMIN"))
                .build();
    }
}
