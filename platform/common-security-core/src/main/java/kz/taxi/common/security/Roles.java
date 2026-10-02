package kz.taxi.common.security;

import java.util.Set;

/**
 * Role names used across the platform.
 *
 * <p>Deliberately few: Taxi products grow roles slowly and multiply
 * permissions instead. {@code role -> authority} translation lives here so no
 * service invents its own {@code ROLE_} prefix convention.
 */
public final class Roles {

    /** Retail client: owns accounts, sends transfers, buys in the marketplace. */
    public static final String CUSTOMER = "CUSTOMER";
    /** Merchant: publishes offers, sees settlements. */
    public static final String MERCHANT = "MERCHANT";
    /** Support agent: read-only access to other users' data, with audit. */
    public static final String SUPPORT = "SUPPORT";
    /** Platform operator: can mint demo funds, freeze accounts. */
    public static final String ADMIN = "ADMIN";

    public static final String PREFIX = "ROLE_";

    public static final Set<String> ALL = Set.of(CUSTOMER, MERCHANT, SUPPORT, ADMIN);

    private Roles() {
    }

    public static String authority(String role) {
        if (role == null || role.isBlank()) {
            throw new IllegalArgumentException("role must not be blank");
        }
        String normalized = role.trim().toUpperCase();
        return normalized.startsWith(PREFIX) ? normalized : PREFIX + normalized;
    }

    public static boolean isKnown(String role) {
        return role != null && ALL.contains(role.trim().toUpperCase());
    }
}
