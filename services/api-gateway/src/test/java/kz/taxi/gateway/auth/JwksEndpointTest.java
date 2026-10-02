package kz.taxi.gateway.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import kz.taxi.common.security.JwtIssuer;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.common.security.autoconfigure.SecurityCoreAutoConfiguration;
import kz.taxi.gateway.config.GatewayIdentityConfig;
import kz.taxi.gateway.config.GatewaySecurityConfig;
import kz.taxi.gateway.identity.RsaSigningKeyProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.reactive.WebFluxTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The JWKS endpoint itself, plus the default (HMAC) gateway chain around it.
 *
 * <p>The endpoint is public by design — a verifier cannot present a token in order to
 * learn how to validate tokens — so this test asserts both halves of that contract:
 * anonymous access works, and the protected paths are still protected.
 */
@WebFluxTest(controllers = {JwksController.class, AuthController.class})
@Import({GatewaySecurityConfig.class, GatewayIdentityConfig.class, SecurityCoreAutoConfiguration.class})
@TestPropertySource(properties = {
        "taxi.security.jwt-secret=gateway-test-secret-long-enough-0123456789",
        "taxi.security.issuer-uri=https://identity.taxi.test",
        "taxi.security.public-paths=/api/v1/auth/**,/.well-known/jwks.json",
        // The first blocking read in a slice context pays for class loading and the
        // cold security chain; the default 5s budget is tight enough to fail on a
        // loaded machine, which looks like a broken endpoint rather than a slow one.
        "spring.test.webtestclient.timeout=20s"
})
class JwksEndpointTest {

    @Autowired
    private WebTestClient webTestClient;

    @Autowired
    private RsaSigningKeyProvider signingKeyProvider;

    @Autowired
    private JwtIssuer jwtIssuer;

    @Autowired
    private SecurityProperties properties;

    @Test
    @DisplayName("serves a valid key set without any token")
    void jwks_is_anonymous() {
        webTestClient.get().uri(JwksController.JWKS_PATH)
                .exchange()
                .expectStatus().isOk()
                .expectHeader().contentTypeCompatibleWith("application/json")
                .expectHeader().valueMatches("Cache-Control", ".*max-age=\\d+.*")
                .expectBody()
                .jsonPath("$.keys.length()").isEqualTo(1)
                .jsonPath("$.keys[0].kty").isEqualTo("RSA")
                .jsonPath("$.keys[0].kid").isEqualTo(signingKeyProvider.signingKey().getKeyID())
                .jsonPath("$.keys[0].alg").isEqualTo("RS256");
    }

    @Test
    @DisplayName("never publishes private key material")
    void jwks_contains_public_key_only() {
        byte[] body = webTestClient.get().uri(JwksController.JWKS_PATH)
                .exchange()
                .expectStatus().isOk()
                .expectBody().returnResult().getResponseBody();

        String document = new String(body != null ? body : new byte[0]);

        // `d`, `p`, `q` and friends are the private CRT parameters: publishing them would
        // hand the ability to mint tokens to anyone who can read a public URL.
        assertThat(document).doesNotContain("\"d\"").doesNotContain("\"p\"").doesNotContain("\"q\"");
        assertThat(document).contains("\"n\"").contains("\"e\"");
    }

    @Test
    @DisplayName("the key set parses as a JWK Set a resource server can use")
    void jwks_is_a_usable_key_set() throws Exception {
        byte[] body = webTestClient.get().uri(JwksController.JWKS_PATH)
                .exchange()
                .expectStatus().isOk()
                .expectBody().returnResult().getResponseBody();

        JWKSet keySet = JWKSet.parse(new String(body != null ? body : new byte[0]));

        assertThat(keySet.getKeys()).hasSize(1);
        assertThat(keySet.getKeyByKeyId(signingKeyProvider.signingKey().getKeyID())).isNotNull();
        assertThat(keySet.getKeys().get(0).isPrivate()).isFalse();
    }

    @Test
    @DisplayName("HMAC mode still protects the authenticated endpoints")
    void protected_path_still_requires_a_token() {
        webTestClient.get().uri("/api/v1/auth/me")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody()
                .jsonPath("$.code").isEqualTo("UNAUTHORIZED");
    }

    @Test
    @DisplayName("HMAC mode keeps issuing and accepting HS256 tokens through the same chain")
    void hmac_mode_still_works() {
        assertThat(properties.mode()).isEqualTo(SecurityMode.HMAC);
        assertThat(jwtIssuer.algorithm().getName()).isEqualTo("HS256");

        String token = jwtIssuer.issue("U-1", "+77001234567", "Test", Set.of("ADMIN")).accessToken();

        webTestClient.get().uri("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.userId").isEqualTo("U-1")
                .jsonPath("$.roles[0]").isEqualTo("ADMIN");
    }

    @Test
    @DisplayName("a token minted by the auth endpoint is accepted at the edge")
    void issued_token_is_accepted() throws Exception {
        String tokenBody = webTestClient.post().uri("/api/v1/auth/token")
                .header("Content-Type", "application/json")
                .bodyValue("{\"phone\":\"+77001234567\",\"code\":\"0000\",\"roles\":[\"MERCHANT\"]}")
                .exchange()
                .expectStatus().isOk()
                .expectBody(String.class)
                .returnResult()
                .getResponseBody();

        String token = new ObjectMapper().readTree(tokenBody).get("accessToken").asText();

        webTestClient.get().uri("/api/v1/auth/me")
                .header("Authorization", "Bearer " + token)
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.phone").isEqualTo("+77001234567")
                .jsonPath("$.roles[0]").isEqualTo("MERCHANT");
    }
}
