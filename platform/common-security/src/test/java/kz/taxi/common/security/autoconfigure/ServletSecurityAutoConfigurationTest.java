package kz.taxi.common.security.autoconfigure;

import kz.taxi.common.security.JwtIssuer;
import kz.taxi.common.security.SecurityProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Set;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Proves the default posture end to end: anonymous calls get a 401 problem
 * document, a valid token is accepted, and role checks are enforced.
 */
@SpringBootTest(classes = ServletSecurityAutoConfigurationTest.TestApplication.class)
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "taxi.security.jwt-secret=integration-test-secret-long-enough-0123456789",
        "taxi.security.public-paths=/api/v1/open",
        "taxi.idempotency.store=memory"
})
class ServletSecurityAutoConfigurationTest {

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

    private String token(Set<String> roles) {
        return "Bearer " + new JwtIssuer(properties).issue("U-1", "+77001234567", "Test", roles).accessToken();
    }

    @Test
    @DisplayName("allows anonymous access to configured public paths")
    void allows_public_paths() throws Exception {
        mockMvc.perform(get("/api/v1/open"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("returns RFC 7807 problem+json with a correlation id for anonymous calls")
    void rejects_anonymous_with_problem_json() throws Exception {
        mockMvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().exists("X-Correlation-Id"))
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.correlationId").isNotEmpty());
    }

    @Test
    @DisplayName("accepts a token signed with the shared secret")
    void accepts_valid_token() throws Exception {
        mockMvc.perform(get("/api/v1/me").header("Authorization", token(Set.of("CUSTOMER"))))
                .andExpect(status().isOk())
                .andExpect(content().string("subject=U-1"));
    }

    @Test
    @DisplayName("enforces method-level role checks")
    void enforces_roles() throws Exception {
        mockMvc.perform(get("/api/v1/ops").header("Authorization", token(Set.of("CUSTOMER"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        mockMvc.perform(get("/api/v1/ops").header("Authorization", token(Set.of("ADMIN"))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("rejects a token signed with another secret")
    void rejects_foreign_token() throws Exception {
        SecurityProperties other = SecurityProperties.hmac("a-completely-different-secret-0123456789ab",
                properties.jwtTtl(), properties.issuer(), properties.rolesClaim(),
                properties.corsAllowedOrigins(), properties.publicPaths());
        String foreign = "Bearer " + new JwtIssuer(other).issue("U-1", null, null, Set.of("ADMIN")).accessToken();

        mockMvc.perform(get("/api/v1/me").header("Authorization", foreign))
                .andExpect(status().isUnauthorized());
    }
}
