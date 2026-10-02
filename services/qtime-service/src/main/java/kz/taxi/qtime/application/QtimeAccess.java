package kz.taxi.qtime.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.QtimeErrorCode;

/**
 * Who may do what in the QTime API.
 *
 * <p>Written out rather than expressed as path matchers in configuration: "only a
 * client books, a merchant cancels on behalf of the company, support and admin read
 * everything" is a business decision, and a business decision hidden in a YAML list of
 * URL patterns is one refactor away from being wrong (the same reasoning as
 * {@code DispatchAccess}).
 *
 * <p>What is deliberately <em>not</em> here: whether a merchant is allowed to cancel
 * *this* booking. Company ownership (which merchant user manages which company) is not
 * modeled in QTime yet — the company comes from the catalogue of the vertical, and the
 * link to a merchant account arrives with the ORTA Business calendar. Until then a
 * MERCHANT or ADMIN may cancel any booking, which is a documented hole rather than a
 * silent one.
 */
public final class QtimeAccess {

    private QtimeAccess() {
    }

    /** A window is taken by a client, and by nobody else. */
    public static void requireBookingClient(AuthenticatedUser user) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!user.hasRole(Roles.CUSTOMER)) {
            throw DomainException.of(QtimeErrorCode.CUSTOMER_ROLE_REQUIRED,
                    "user {} may not create a booking: the role CUSTOMER is required", user.userId());
        }
    }

    /** Cancelling on behalf of the company rather than as the client. */
    public static boolean isCompanySide(AuthenticatedUser user) {
        return user.isMerchant() || user.isAdmin();
    }

    /** The owner of a booking, or an operator reading somebody else's calendar. */
    public static boolean readsEverything(AuthenticatedUser user) {
        return user.isAdmin() || user.hasRole(Roles.SUPPORT);
    }

    /** Ensures the caller owns the booking, or is an operator. */
    public static void requireAccess(AuthenticatedUser user, Booking booking) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!readsEverything(user) && !booking.belongsTo(user.userId())) {
            throw DomainException.of(QtimeErrorCode.FORBIDDEN_BOOKING_ACCESS,
                            "booking {} belongs to another user", booking.getId())
                    .withDetail("bookingId", booking.getId());
        }
    }
}
