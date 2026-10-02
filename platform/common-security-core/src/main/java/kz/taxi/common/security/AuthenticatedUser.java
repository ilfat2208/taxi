package kz.taxi.common.security;

import org.springframework.security.oauth2.jwt.Jwt;

import java.util.Set;

/**
 * The authenticated caller, as domain code wants to see it.
 *
 * <p>Controllers and application services never touch {@link Jwt} directly:
 * they receive an {@code AuthenticatedUser}, which keeps token details (claims,
 * scopes, key ids) out of business logic and makes it trivial to change the
 * identity provider later.
 */
public record AuthenticatedUser(String userId, String phone, String displayName, Set<String> roles) {

    public static AuthenticatedUser from(Jwt jwt, String rolesClaim) {
        if (jwt == null) {
            return null;
        }
        String phone = jwt.getClaimAsString("phone");
        String displayName = jwt.getClaimAsString("name");
        return new AuthenticatedUser(jwt.getSubject(), phone, displayName, JwtSupport.rolesOf(jwt, rolesClaim));
    }

    public boolean hasRole(String role) {
        return roles.contains(role == null ? "" : role.trim().toUpperCase());
    }

    public boolean isAdmin() {
        return hasRole(Roles.ADMIN);
    }

    public boolean isMerchant() {
        return hasRole(Roles.MERCHANT);
    }

    /** True when the caller is the owner of the resource or an operator. */
    public boolean canAccess(String ownerUserId) {
        return isAdmin() || hasRole(Roles.SUPPORT) || (userId != null && userId.equals(ownerUserId));
    }
}
