package kz.taxi.common.security.autoconfigure;

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
import kz.taxi.common.security.JwtIssuer;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The production posture end to end: a service that starts with <b>no</b> {@code jwt-secret}
 * and validates RS256 tokens against the issuer's public key set.
 *
 * <p>This is the test that proves the migration promise in {@code docs/identity.md}: the
 * secret can be deleted from a service, and everything else — path rules, {@code @PreAuthorize},
 * 401/403 shapes, the principal model — behaves exactly as it does in HMAC mode.
 */
@SpringBootTest(classes = JwksModeSecurityAutoConfigurationTest.TestApplication.class)
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        // No taxi.security.jwt-secret here on purpose: in JWKS mode a service must not
        // need one, and must not hold one.
        "taxi.security.mode=JWKS",
        "taxi.security.issuer-uri=" + JwksModeSecurityAutoConfigurationTest.ISSUER,
        "taxi.security.public-paths=/api/v1/open",
        "taxi.idempotency.store=memory"
})
class JwksModeSecurityAutoConfigurationTest {

    static final String ISSUER = "https://identity.taxi.test";

    private static final RSAKey ISSUER_KEY = generateKey("issuer-key-1");
    private static final JwksTestServer JWKS = JwksTestServer.start(new JWKSet(ISSUER_KEY.toPublicJWK()));

    @DynamicPropertySource
    static void jwksLocation(DynamicPropertyRegistry registry) {
        registry.add("taxi.security.jwk-set-uri", JWKS::url);
    }

    @SpringBootApplication
    @RestController
    static class TestApplication {

        @GetMapping("/api/v1/open")
        String open() {
            return "open";
        }

        @GetMapping("/api/v1/me")
        String me(@AuthenticationPrincipal Jwt jwt) {
            return "subject=" + jwt.getSubject();
        }

        @GetMapping("/api/v1/ops")
        @PreAuthorize("hasRole('ADMIN')")
        String ops() {
            return "ops";
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private SecurityProperties properties;

    @Autowired
    private JwtDecoder jwtDecoder;

    private static RSAKey generateKey(String keyId) {
        try {
            return new RSAKeyGenerator(2048).keyID(keyId).generate();
        } catch (Exception ex) {
            throw new IllegalStateException("cannot generate a test RSA key", ex);
        }
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private String issuerToken(Set<String> roles) {
        return new JwtIssuer(properties, ISSUER_KEY).issue("U-1", "+77001234567", "Test", roles).accessToken();
    }

    @Test
    @DisplayName("starts without any jwt-secret and still has a working resource server")
    void starts_without_a_secret() {
        assertThat(properties.mode()).isEqualTo(SecurityMode.JWKS);
        assertThat(properties.hasSecret()).isFalse();
        assertThat(properties.jwtSecret()).isNull();
        assertThat(jwtDecoder).isNotNull();
    }

    @Test
    @DisplayName("accepts a token signed by the issuer's private key")
    void accepts_issuer_token() throws Exception {
        mockMvc.perform(get("/api/v1/me").header("Authorization", bearer(issuerToken(Set.of("CUSTOMER")))))
                .andExpect(status().isOk())
                .andExpect(content().string("subject=U-1"));
    }

    @Test
    @DisplayName("enforces method-level roles on JWKS-verified tokens")
    void enforces_roles() throws Exception {
        mockMvc.perform(get("/api/v1/ops").header("Authorization", bearer(issuerToken(Set.of("CUSTOMER")))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/v1/ops").header("Authorization", bearer(issuerToken(Set.of("ADMIN")))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("anonymous calls still get a 401 problem document")
    void rejects_anonymous() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("a token signed by someone else's RSA key is rejected")
    void rejects_foreign_key() {
        RSAKey rogue = generateKey("rogue-key");
        String token = new JwtIssuer(properties, rogue).issue("U-1", null, null, Set.of("ADMIN")).accessToken();

        assertRejected(token);
    }

    @Test
    @DisplayName("algorithm confusion: an HS256 token is rejected by a JWKS service")
    void rejects_algorithm_confusion() throws Exception {
        byte[] publicKeyBytes = ISSUER_KEY.toRSAPublicKey().getEncoded();
        SignedJWT forged = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.HS256).keyID("issuer-key-1").build(),
                claims());
        forged.sign(new MACSigner(publicKeyBytes));

        assertRejected(forged.serialize());
    }

    @Test
    @DisplayName("alg=none is rejected")
    void rejects_alg_none() {
        assertRejected(new PlainJWT(claims()).serialize());
    }

    @Test
    @DisplayName("a token whose kid is not published is rejected")
    void rejects_unknown_kid() throws Exception {
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID("kid-that-was-never-published").build(),
                claims());
        jwt.sign(new RSASSASigner(ISSUER_KEY));

        assertRejected(jwt.serialize());
    }

    private void assertRejected(String token) {
        try {
            mockMvc.perform(get("/api/v1/me").header("Authorization", bearer(token)))
                    .andExpect(status().isUnauthorized());
        } catch (Exception ex) {
            throw new AssertionError("token should have been rejected with 401", ex);
        }
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
