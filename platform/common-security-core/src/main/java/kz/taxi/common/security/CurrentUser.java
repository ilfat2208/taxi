package kz.taxi.common.security;

import kz.taxi.common.core.error.DomainException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Optional;

/**
 * Reads the current caller from the security context.
 *
 * <p>Note for reactive code: in a WebFlux application the security context lives
 * in the Reactor context, not in a {@code ThreadLocal}, so the api-gateway uses
 * {@code @AuthenticationPrincipal Jwt} instead of this helper. Servlet-based
 * domain services use this class.
 *
 * <p>Registered by {@code SecurityCoreAutoConfiguration}, not by component
 * scanning: a service must be able to override it with its own bean.
 */
public class CurrentUser {

    private final SecurityProperties properties;

    public CurrentUser(SecurityProperties properties) {
        this.properties = properties;
    }

    public Optional<AuthenticatedUser> optional() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return Optional.empty();
        }
        if (authentication.getPrincipal() instanceof Jwt jwt) {
            return Optional.ofNullable(AuthenticatedUser.from(jwt, properties.rolesClaim()));
        }
        return Optional.empty();
    }

    /** The caller, or 401 — used by use cases that cannot work anonymously. */
    public AuthenticatedUser require() {
        return optional().orElseThrow(() -> DomainException.unauthorized("authentication required"));
    }

    public String requireUserId() {
        return require().userId();
    }

    /** Ensures the caller owns the resource (or is an operator), otherwise 403. */
    public AuthenticatedUser requireAccessTo(String ownerUserId) {
        AuthenticatedUser user = require();
        if (!user.canAccess(ownerUserId)) {
            throw DomainException.forbidden("user {} may not access resources of {}",
                    user.userId(), ownerUserId);
        }
        return user;
    }
}
