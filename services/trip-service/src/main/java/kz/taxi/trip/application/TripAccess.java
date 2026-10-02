package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.trip.domain.TripErrorCode;

/**
 * Who may see a trip, cancel it, or assign a driver to it.
 *
 * <p>Written out rather than expressed as path matchers: "a rider sees his own rides,
 * dispatchers see the live board and may put a car on it or take a stuck one off it,
 * support and operators see everything, and only a dispatcher may put a car on
 * somebody's ride" is a business decision, and a business decision hidden in a YAML
 * list of URL patterns is one refactor away from being wrong.
 *
 * <p>Two asymmetries are deliberate:
 * <ul>
 *   <li><b>Support may look but not touch.</b> SUPPORT reads any trip — that is the
 *       whole point of a support desk — but assigning or cancelling moves money and a
 *       car, and doing that from a support screen would bypass the dispatcher's audit
 *       trail. Support <em>is</em> allowed to cancel here because the roadmap
 *       ({@code docs/taxi-roadmap.md}) puts "отмена с причиной" in the dispatcher's
 *       console as a DISPATCHER/SUPPORT capability; a refundable incident is handled at
 *       that desk.</li>
 *   <li><b>A non-owner must say why.</b> The rider knows why he cancelled his own ride;
 *       a dispatcher who closes somebody else's request has to leave a reason behind,
 *       because that is the only record the rider and the driver will see.</li>
 * </ul>
 */
public final class TripAccess {

    /** Whose side called the ride off — which decides whether a reason is mandatory. */
    public enum Canceller {
        /** The rider himself: his ride, his decision, a reason is optional. */
        RIDER,
        /** A dispatcher, support agent or operator: acting on someone else's ride. */
        OPERATOR
    }

    private TripAccess() {
    }

    /** Ordering a ride is a customer action. A driver or a merchant has no business here. */
    public static void requireRider(AuthenticatedUser user) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!user.hasRole(Roles.CUSTOMER)) {
            throw DomainException.of(TripErrorCode.FORBIDDEN_TRIP_ACCESS,
                            "user {} may not order rides: the CUSTOMER role is required", user.userId())
                    .withDetail("requiredRole", Roles.CUSTOMER);
        }
    }

    /** A single trip: its rider, support, an operator. */
    public static void requireReader(AuthenticatedUser user, String riderUserId) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!user.canAccess(riderUserId)) {
            throw DomainException.of(TripErrorCode.FORBIDDEN_TRIP_ACCESS,
                            "user {} may not read trips of {}", user.userId(), riderUserId)
                    .withDetail("riderUserId", riderUserId);
        }
    }

    /**
     * Who may call a ride off.
     *
     * <p>Allowed: the rider himself, a DISPATCHER, a SUPPORT agent and an ADMIN — the
     * last three because a dispatcher's job includes unblocking the board ("the driver
     * never arrived"), and because a support desk that cannot stop a doomed ride has to
     * escalate a two-minute fix into a ticket.
     *
     * <p>Refused: everybody else, in particular MERCHANT and DRIVER. A driver releases
     * himself through his own service; he does not cancel the rider's order in the trip
     * API, because the money released here is the rider's.
     *
     * <p>What is <em>not</em> checked here is the trip's status: "cancellable" is a
     * property of the aggregate ({@link kz.taxi.trip.domain.TripStatus#isCancellable()}),
     * so a dispatcher is refused after {@code IN_PROGRESS} by exactly the same rule that
     * refuses the rider — the fare is owed once the rider is in the car, and no role
     * changes that.
     *
     * @return who is asking, so the caller can require a reason from a non-owner
     */
    public static Canceller requireCanceller(AuthenticatedUser user, String riderUserId) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (user.userId() != null && user.userId().equals(riderUserId)) {
            return Canceller.RIDER;
        }
        if (isOperator(user) || user.hasRole(Roles.DISPATCHER)) {
            return Canceller.OPERATOR;
        }
        throw DomainException.of(TripErrorCode.FORBIDDEN_TRIP_ACCESS,
                        "user {} may not cancel trips of {}", user.userId(), riderUserId)
                .withDetail("riderUserId", riderUserId);
    }

    /**
     * A non-owner must leave a reason.
     *
     * <p>Checked in the application layer rather than as a bean-validation annotation on
     * the request, because whether the reason is required depends on who is calling —
     * something the request body alone does not know.
     */
    public static void requireCancellationReason(Canceller canceller, String reason) {
        if (canceller == Canceller.OPERATOR && (reason == null || reason.isBlank())) {
            throw DomainException.of(TripErrorCode.CANCEL_REASON_REQUIRED,
                    "a dispatcher or operator must give a reason when cancelling somebody else's trip");
        }
    }

    /**
     * Putting a driver on a ride by hand.
     *
     * <p>DISPATCHER or ADMIN only. A dispatcher is the person whose job is to fix a
     * stuck board, and an operator is the platform itself; nobody else may decide that a
     * particular car goes to a particular rider, because that decision also reserves the
     * rider's money. SUPPORT is deliberately excluded: reading is the support desk's
     * job, moving cars is not.
     */
    public static void requireAssigner(AuthenticatedUser user) {
        if (user == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!user.hasRole(Roles.DISPATCHER) && !user.isAdmin()) {
            throw DomainException.of(TripErrorCode.FORBIDDEN_TRIP_ASSIGNMENT,
                            "user {} may not assign drivers: DISPATCHER or ADMIN is required", user.userId())
                    .withDetail("requiredRole", Roles.DISPATCHER);
        }
    }

    /** Support and administrators: every trip, any status. */
    public static boolean isOperator(AuthenticatedUser user) {
        return user != null && (user.isAdmin() || user.hasRole(Roles.SUPPORT));
    }

    /** The dispatcher's board: every live request, so that a car can be put on one. */
    public static boolean isDispatcher(AuthenticatedUser user) {
        return user != null && user.hasRole(Roles.DISPATCHER);
    }

    /** The actor recorded in the timeline for a cancellation by this caller. */
    public static String cancellationActor(AuthenticatedUser user, Canceller canceller) {
        if (canceller == Canceller.RIDER) {
            return kz.taxi.trip.domain.TripTransition.ACTOR_RIDER;
        }
        return user.hasRole(Roles.DISPATCHER)
                ? kz.taxi.trip.domain.TripTransition.ACTOR_DISPATCHER
                : kz.taxi.trip.domain.TripTransition.ACTOR_SUPPORT;
    }
}
