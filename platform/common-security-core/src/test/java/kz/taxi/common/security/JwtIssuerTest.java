package kz.taxi.common.security;

import kz.taxi.common.core.id.Ulid;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JwtIssuerTest {

    private static final String SECRET = "unit-test-secret-that-is-long-enough-0123456789";

    private SecurityProperties properties() {
        return SecurityProperties.hmac(SECRET, Duration.ofMinutes(15), "taxi-test", "roles",
                List.of(), List.of());
    }

    @Test
    @DisplayName("issues a token that validates with the shared secret and carries roles")
    void issues_verifiable_token() {
        JwtIssuer issuer = new JwtIssuer(properties());

        JwtIssuer.IssuedToken token = issuer.issue("U-1", "+77001234567", "Aisha", Set.of("customer", "ADMIN"));

        assertThat(token.accessToken()).isNotBlank();
        assertThat(token.tokenType()).isEqualTo("Bearer");
        assertThat(token.expiresInSeconds()).isEqualTo(900);

        Jwt decoded = JwtSupport.jwtDecoder(SECRET).decode(token.accessToken());
        assertThat(decoded.getSubject()).isEqualTo("U-1");
        assertThat(decoded.getClaimAsString("phone")).isEqualTo("+77001234567");
        assertThat(decoded.getClaimAsString("iss")).isEqualTo("taxi-test");
        assertThat(decoded.getId()).hasSize(26);
        assertThat(JwtSupport.rolesOf(decoded, "roles")).containsExactlyInAnyOrder("CUSTOMER", "ADMIN");
    }

    @Test
    @DisplayName("defaults anonymous role sets to CUSTOMER instead of issuing a role-less token")
    void defaults_to_customer_role() {
        JwtIssuer issuer = new JwtIssuer(properties());

        Jwt decoded = JwtSupport.jwtDecoder(SECRET).decode(issuer.issue("U-2", null, null, Set.of()).accessToken());

        assertThat(JwtSupport.rolesOf(decoded, "roles")).containsExactly("CUSTOMER");
    }

    @Test
    @DisplayName("refuses a secret shorter than 256 bits")
    void rejects_weak_secret() {
        assertThatThrownBy(() -> JwtSupport.secretKey("too-short"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("at least 32 bytes");
    }

    @Test
    @DisplayName("maps a JWT to the domain principal")
    void builds_authenticated_user() {
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "HS256")
                .subject("U-3")
                .claim("phone", "+77001112233")
                .claim("name", "Dana")
                .claim("roles", List.of("MERCHANT"))
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .build();

        AuthenticatedUser user = AuthenticatedUser.from(jwt, "roles");

        assertThat(user).isNotNull();
        assertThat(user.userId()).isEqualTo("U-3");
        assertThat(user.isMerchant()).isTrue();
        assertThat(user.isAdmin()).isFalse();
        assertThat(user.canAccess("U-3")).isTrue();
        assertThat(user.canAccess("U-OTHER")).isFalse();
    }

    @Test
    @DisplayName("tolerates roles delivered as a space-separated string claim")
    void parses_string_roles_claim() {
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "HS256")
                .subject("U-4")
                .claim("roles", "customer admin")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .build();

        assertThat(JwtSupport.rolesOf(jwt, "roles")).containsExactlyInAnyOrder("CUSTOMER", "ADMIN");
        assertThat(AuthenticatedUser.from(jwt, "roles").isAdmin()).isTrue();
    }

    @Test
    @DisplayName("builds role authorities with a single, consistent prefix")
    void builds_authorities() {
        assertThat(Roles.authority("merchant")).isEqualTo("ROLE_MERCHANT");
        assertThat(Roles.authority("ROLE_ADMIN")).isEqualTo("ROLE_ADMIN");
        assertThat(Roles.ALL)
                .containsExactlyInAnyOrder("CUSTOMER", "MERCHANT", "SUPPORT", "ADMIN", "DRIVER", "DISPATCHER");
        assertThat(Roles.isKnown("customer")).isTrue();
        assertThat(Roles.isKnown("driver")).isTrue();
        assertThat(Roles.isKnown("nobody")).isFalse();
    }

    @Test
    @DisplayName("principal keeps unknown claims out of the domain model")
    void ignores_unknown_claims() {
        Jwt jwt = Jwt.withTokenValue("t")
                .header("alg", "HS256")
                .subject("U-5")
                .claim("roles", List.of("SUPPORT"))
                .claim("internalFlag", "secret")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .build();

        AuthenticatedUser user = AuthenticatedUser.from(jwt, "roles");

        assertThat(user.roles()).containsExactly("SUPPORT");
        assertThat(user.canAccess("U-SOMEONE-ELSE")).isTrue();
    }
}
