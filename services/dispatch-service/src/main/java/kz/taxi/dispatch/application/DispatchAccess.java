package kz.taxi.dispatch.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.dispatch.domain.DispatchErrorCode;

/**
 * Who may do what in the dispatch API.
 *
 * <p>Written out rather than expressed as path matchers in configuration: the rule
 * "the live fleet is visible to dispatchers and support, and to nobody else" is a
 * business decision, and a business decision hidden in a YAML list of URL patterns
 * is one refactor away from being wrong.
 */
public final class DispatchAccess {

    private DispatchAccess() {
    }

    /** The fleet map is an operational tool: riders and drivers have no business here. */
    public static void requireFleetReader(AuthenticatedUser user) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!user.hasRole(Roles.DISPATCHER) && !user.hasRole(Roles.SUPPORT) && !user.isAdmin()) {
            throw DomainException.of(DispatchErrorCode.FORBIDDEN_FLEET_ACCESS,
                    "user {} may not read the live fleet", user.userId());
        }
    }

    /** Positions come from driver apps, and from nowhere else. */
    public static void requireDriver(AuthenticatedUser user) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!user.hasRole(Roles.DRIVER)) {
            throw DomainException.forbidden("only a driver app may report positions");
        }
    }
}
