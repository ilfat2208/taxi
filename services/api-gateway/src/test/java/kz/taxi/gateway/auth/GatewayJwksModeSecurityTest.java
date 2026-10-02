package kz.taxi.gateway.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.PlainJWT;
import com.nimbusds.jwt.SignedJWT;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.common.security.autoconfigure.SecurityCoreAutoConfiguration;
import kz.taxi.gateway.config.GatewayIdentityConfig;
import kz.taxi.gateway.config.GatewaySecurityConfig;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.time.Instant;
import java.util.Date;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The gateway in JWKS mode: it signs with its configured private key, publishes the
 * matching public key, and validates through an actual JWKS URL — no shared secret
 * anywhere in the picture.
 */
@WebFluxTest(controllers = {JwksController.class, AuthController.class})
@Import({GatewaySecurityConfig.class, GatewayIdentityConfig.class, SecurityCoreAutoConfiguration.class})
class GatewayJwksModeSecurityTest {

    private static final String ISSUER = "https://identity.taxi.test";

    /** The key a real deployment would provision through configuration. */
    private static final RSAKey GATEWAY_KEY = generateKey("gateway-key-1");
    private static final JwksTestServer JWKS = JwksTestServer.start(new JWKSet(GATEWAY_KEY.toPublicJWK()));

    @DynamicPropertySource
    static void gatewayProperties(DynamicPropertyRegistry registry) {
        // Blanked on purpose: application.yml carries a local default secret, and JWKS mode
        // must work with no secret at all — a resource server that holds one could mint tokens.
        registry.add("taxi.security.jwt-secret", () -> "");
        registry.add("taxi.security.mode", () -> "JWKS");
        registry.add("taxi.security.issuer-uri", () -> ISSUER);
        registry.add("taxi.security.jwk-set-uri", JWKS::url);
        registry.add("taxi.security.signing-key", GATEWAY_KEY::toJSONString);
        registry.add("taxi.security.public-paths", () -> "/api/v1/auth/**,/.well-known/jwks.json");
    }

    @AfterAll
    static void stopServer() {
        JWKS.close();
    }

    @Autowired
    private WebTestClient webTestClient;

    @Autowired
    private SecurityProperties properties;

    private static RSAKey generateKey(String keyId) {
        try {
            return new RSAKeyGenerator(2048).keyID(keyId).generate();
        } catch (Exception ex) {
            throw new IllegalStateException("cannot generate a test RSA key", ex);
        }
    }

    /** Asks the gateway's own login endpoint for a token, exactly like a client would. */
    private String obtainToken() throws Exception {
        String body = webTestClient.post().uri("/api/v1/auth/token")
                .header("Content-Type", "application/json")
                .bodyValue("{\"phone\":\"+77001234567\",\"code\":\"0000\",\"roles\":[\"ADMIN\"]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class)
                .returnResult()
                .getResponseBody();
        return new ObjectMapper().readTree(body).get("accessToken").asText();
    }

    private void expectUnauthorized(String token) {
        webTestClient.get().uri("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    @DisplayName("runs without a jwt-secret and validates its own RS256 token through JWKS")
    void validates_its_own_rs256_token() throws Exception {
        assertThat(properties.mode()).isEqualTo(SecurityMode.JWKS);
        assertThat(properties.hasSecret()).isFalse();

        String token = obtainToken();

        webTestClient.get().uri("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.phone").isEqualTo("+77001234567")
                .jsonPath("$.roles[0]").isEqualTo("ADMIN");
    }

    @Test
    @DisplayName("the token header names exactly the kid the published key set advertises")
    void token_kid_matches_the_published_key_set() throws Exception {
        SignedJWT parsed = SignedJWT.parse(obtainToken());

        assertThat(parsed.getHeader().getAlgorithm().getName()).isEqualTo("RS256");
        assertThat(parsed.getHeader().getKeyID()).isEqualTo(GATEWAY_KEY.getKeyID());
        assertThat(parsed.verify(new com.nimbusds.jose.crypto.RSASSAVerifier(GATEWAY_KEY.toRSAPublicKey())))
                .isTrue();

        String document = webTestClient.get().uri(JwksController.JWKS_PATH)
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class)
                .returnResult()
                .getResponseBody();

        JWKSet published = JWKSet.parse(document);
        assertThat(published.getKeyByKeyId(parsed.getHeader().getKeyID())).isNotNull();
        assertThat(published.getKeys().get(0).isPrivate()).isFalse();
    }

    @Test
    @DisplayName("a token signed by another RSA key is rejected, even with a valid issuer")
    void rejects_foreign_signer() throws Exception {
        RSAKey rogue = generateKey("rogue-key");
        SignedJWT forged = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("rogue-key").build(), claims());
        forged.sign(new RSASSASigner(rogue));

        expectUnauthorized(forged.serialize());
    }

    @Test
    @DisplayName("algorithm confusion: an HS256 token is rejected at the edge")
    void rejects_algorithm_confusion() throws Exception {
        SignedJWT forged = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.HS256).keyID(GATEWAY_KEY.getKeyID()).build(), claims());
        forged.sign(new MACSigner(GATEWAY_KEY.toRSAPublicKey().getEncoded()));

        expectUnauthorized(forged.serialize());
    }

    @Test
    @DisplayName("alg=none is rejected at the edge")
    void rejects_alg_none() {
        expectUnauthorized(new PlainJWT(claims()).serialize());
    }

    @Test
    @DisplayName("the public key set is still reachable anonymously")
    void jwks_is_public_in_jwks_mode() {
        webTestClient.get().uri(JwksController.JWKS_PATH)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.keys[0].kid").isEqualTo(GATEWAY_KEY.getKeyID());
    }

    private static JWTClaimsSet claims() {
        Instant now = Instant.now();
        return new JWTClaimsSet.Builder()
                .issuer(ISSUER)
                .subject("U-1")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plusSeconds(300)))
                .claim("roles", List.of("ADMIN"))
                .build();
    }
}
