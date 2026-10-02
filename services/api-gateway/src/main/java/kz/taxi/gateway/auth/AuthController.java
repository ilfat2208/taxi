package kz.taxi.gateway.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.JwtIssuer;
import kz.taxi.common.security.Roles;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Development identity provider.
 *
 * <p>Taxi products authenticate a phone number, not an email, and this
 * endpoint mirrors that shape: {@code phone} + SMS {@code code}. In this project
 * it replaces the SMS provider so the whole stack runs locally, so it is
 * intentionally obvious that it is not production-grade:
 * <ul>
 *   <li>the code is compared against a configured value, never persisted;</li>
 *   <li>the user id is derived deterministically from the phone, so a demo
 *       account keeps its data across restarts;</li>
 *   <li>{@code ADMIN} can only be requested when explicitly enabled.</li>
 * </ul>
 * In production this controller is deleted and replaced by the real OIDC
 * provider — nothing else in the platform changes, because services only ever
 * validate tokens.
 */
@RestController
@RequestMapping("/api/v1/auth")
@Slf4j
public class AuthController {

    public record TokenRequest(
            @NotBlank(message = "phone is required")
            @Pattern(regexp = "^\\+?[0-9]{10,15}$", message = "phone must be 10..15 digits, optionally prefixed by +")
            String phone,
            @NotBlank(message = "code is required")
            @Size(min = 4, max = 8, message = "code must be 4..8 characters")
            String code,
            String displayName,
            List<String> roles
    ) {
    }

    public record TokenResponse(String accessToken, String tokenType, long expiresIn, String userId, Set<String> roles) {
    }

    public record ProfileResponse(String userId, String phone, String displayName, Set<String> roles) {
    }

    private final JwtIssuer jwtIssuer;
    private final String acceptedCode;
    private final boolean adminEnabled;

    public AuthController(JwtIssuer jwtIssuer,
                          @Value("${taxi.gateway.identity.accepted-code:0000}") String acceptedCode,
                          @Value("${taxi.gateway.identity.admin-enabled:true}") boolean adminEnabled) {
        this.jwtIssuer = jwtIssuer;
        this.acceptedCode = acceptedCode;
        this.adminEnabled = adminEnabled;
    }

    @PostMapping("/token")
    @ResponseStatus(HttpStatus.OK)
    public Mono<TokenResponse> token(@Valid @RequestBody TokenRequest request) {
        if (!acceptedCode.equals(request.code())) {
            throw DomainException.unauthorized("invalid confirmation code");
        }

        String userId = userIdFor(request.phone());
        Set<String> roles = resolveRoles(request.roles());
        String displayName = request.displayName() == null || request.displayName().isBlank()
                ? maskedPhone(request.phone())
                : request.displayName();

        JwtIssuer.IssuedToken issued = jwtIssuer.issue(userId, request.phone(), displayName, roles);
        log.info("issued token for userId={} roles={}", userId, roles);

        return Mono.just(new TokenResponse(issued.accessToken(), issued.tokenType(),
                issued.expiresInSeconds(), userId, roles));
    }

    /** Lets a client verify which identity its token carries. */
    @GetMapping("/me")
    public Mono<ProfileResponse> me(@AuthenticationPrincipal Jwt jwt) {
        if (jwt == null) {
            throw DomainException.unauthorized("authentication required");
        }
        AuthenticatedUser user = AuthenticatedUser.from(jwt, "roles");
        return Mono.just(new ProfileResponse(user.userId(), user.phone(), user.displayName(), user.roles()));
    }

    private Set<String> resolveRoles(List<String> requested) {
        Set<String> roles = new LinkedHashSet<>();
        if (requested == null || requested.isEmpty()) {
            roles.add(Roles.CUSTOMER);
            return roles;
        }
        for (String role : requested) {
            String normalized = role == null ? "" : role.trim().toUpperCase();
            if (!Roles.isKnown(normalized)) {
                throw DomainException.validation("unknown role: {}", role);
            }
            if (Roles.ADMIN.equals(normalized) && !adminEnabled) {
                throw DomainException.forbidden("requesting ADMIN is disabled");
            }
            roles.add(normalized);
        }
        if (roles.isEmpty()) {
            roles.add(Roles.CUSTOMER);
        }
        return roles;
    }

    /** Stable id per phone number: {@code U-<10 hex chars>}. */
    static String userIdFor(String phone) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(phone.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return "U-" + HexFormat.of().formatHex(hash).substring(0, 10).toUpperCase();
        } catch (Exception ex) {
            throw new IllegalStateException("cannot derive user id", ex);
        }
    }

    private static String maskedPhone(String phone) {
        if (phone.length() <= 4) {
            return phone;
        }
        return "*".repeat(phone.length() - 4) + phone.substring(phone.length() - 4);
    }
}
