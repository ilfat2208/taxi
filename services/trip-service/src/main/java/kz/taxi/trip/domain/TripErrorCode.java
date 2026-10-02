package kz.taxi.trip.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure this service can produce.
 *
 * <p>Codes are stable API surface: clients switch on them and the HTTP status is
 * decided here rather than in a controller. Two of them are worth reading twice:
 *
 * <ul>
 *   <li>{@link #INSUFFICIENT_FUNDS} is 422 and not 409: the request was
 *       well-formed, the rider simply cannot pay for this ride. It mirrors the
 *       account service's own code, because the reason must survive the hop between
 *       the two services (a 500 would tell the rider the platform is broken when in
 *       fact his wallet is empty).</li>
 *   <li>{@link #TRIP_NOT_CANCELLABLE} is 409 and is not an error the client should
 *       retry: after {@code IN_PROGRESS} the ride is owed, and the honest answer is
 *       "no", not "try again".</li>
 * </ul>
 */
public enum TripErrorCode implements ErrorCode {

    // ------------------------------------------------------------------ requests
    TRIP_NOT_FOUND("TRIP_NOT_FOUND", 404, "Trip not found"),
    QUOTE_NOT_FOUND("QUOTE_NOT_FOUND", 404, "Quote not found"),
    QUOTE_EXPIRED("QUOTE_EXPIRED", 422, "The quote has expired, please ask for a new price"),
    QUOTE_ALREADY_USED("QUOTE_ALREADY_USED", 409, "This quote has already been used for a trip"),
    QUOTE_NOT_OWNED("QUOTE_NOT_OWNED", 403, "The quote belongs to another rider"),
    INVALID_TARIFF("INVALID_TARIFF", 400, "Unknown tariff"),
    INVALID_COORDINATES("INVALID_COORDINATES", 400, "A coordinate is outside the valid range"),
    INVALID_FARE("INVALID_FARE", 422, "The fare cannot be computed for this ride"),
    INVALID_TRIP_REQUEST("INVALID_TRIP_REQUEST", 400, "The trip request is not usable"),
    NO_PICKUP_POINT("NO_PICKUP_POINT", 400, "A pickup point is required"),
    NO_DROPOFF_POINT("NO_DROPOFF_POINT", 400, "A dropoff point is required"),

    // ------------------------------------------------------------------ lifecycle
    INVALID_TRIP_TRANSITION("INVALID_TRIP_TRANSITION", 409, "The trip cannot move to this status"),
    TRIP_NOT_CANCELLABLE("TRIP_NOT_CANCELLABLE", 409,
            "The trip cannot be cancelled from its current status"),
    /** A dispatcher or operator closing somebody else's ride must say why. */
    CANCEL_REASON_REQUIRED("CANCEL_REASON_REQUIRED", 400,
            "A reason is required when cancelling a trip that is not yours"),
    /**
     * The trip is not waiting for a driver: it already has one, it is in progress or
     * it is over. A dispatcher's assign is refused with this rather than silently
     * changing the driver — two cars at one door is a worse failure than an error.
     */
    TRIP_NOT_ASSIGNABLE("TRIP_NOT_ASSIGNABLE", 409, "The trip is not waiting for a driver"),
    DRIVER_NOT_AVAILABLE("DRIVER_NOT_AVAILABLE", 409,
            "The driver is not free: he is off duty, silent or already carrying a rider"),
    TRIP_NOT_ASSIGNED("TRIP_NOT_ASSIGNED", 409, "The trip has no driver yet"),
    TRIP_NOT_COMPLETED("TRIP_NOT_COMPLETED", 409, "Only a completed trip can be rated or receipted"),
    TRIP_ALREADY_RATED("TRIP_ALREADY_RATED", 409, "The trip has already been rated"),
    INVALID_RATING("INVALID_RATING", 400, "The rating must be between 1 and 5 stars"),
    FORBIDDEN_TRIP_ACCESS("FORBIDDEN_TRIP_ACCESS", 403,
            "Trips are visible to their rider, to support and to operators"),
    FORBIDDEN_TRIP_ASSIGNMENT("FORBIDDEN_TRIP_ASSIGNMENT", 403,
            "Only a dispatcher or an operator may assign a driver by hand"),

    // ------------------------------------------------------------------ money
    INSUFFICIENT_FUNDS("INSUFFICIENT_FUNDS", 422, "Not enough available funds to pay for this ride"),
    RIDER_ACCOUNT_NOT_FOUND("RIDER_ACCOUNT_NOT_FOUND", 422,
            "The rider has no active KZT account; open one before ordering a ride"),
    HOLD_FAILED("HOLD_FAILED", 409, "The fare could not be reserved on the rider's account"),
    CAPTURE_FAILED("CAPTURE_FAILED", 409, "The reserved fare could not be captured"),

    // ------------------------------------------------------------------ downstream
    DOWNSTREAM_UNAVAILABLE("DOWNSTREAM_UNAVAILABLE", 503,
            "A service this trip depends on is unavailable, please retry"),
    DISPATCH_SERVICE_ERROR("DISPATCH_SERVICE_ERROR", 502, "The dispatch service answered unusably"),
    DRIVER_SERVICE_ERROR("DRIVER_SERVICE_ERROR", 502, "The driver service answered unusably"),
    ACCOUNT_SERVICE_ERROR("ACCOUNT_SERVICE_ERROR", 502, "The account service answered unusably");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    TripErrorCode(String code, int httpStatus, String defaultMessage) {
        this.code = code;
        this.httpStatus = httpStatus;
        this.defaultMessage = defaultMessage;
    }

    @Override
    public String code() {
        return code;
    }

    @Override
    public int httpStatus() {
        return httpStatus;
    }

    @Override
    public String defaultMessage() {
        return defaultMessage;
    }
}
