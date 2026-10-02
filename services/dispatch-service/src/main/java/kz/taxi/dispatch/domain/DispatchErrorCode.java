package kz.taxi.dispatch.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure this service can produce.
 *
 * <p>A driver's position is the input dispatch reasons about, so refusing an
 * impossible one loudly matters more than being tolerant: a latitude of {@code 91}
 * or an accuracy of fifty kilometres would put a car into the candidate list for a
 * trip it can never reach.
 */
public enum DispatchErrorCode implements ErrorCode {

    /** The caller is not a known driver: positions come only from the driver app. */
    DRIVER_NOT_FOUND("DRIVER_NOT_FOUND", 404, "No driver profile for this user"),
    /** Off-duty drivers keep no position: the app must stop sending them. */
    DRIVER_NOT_ON_DUTY("DRIVER_NOT_ON_DUTY", 409, "Driver is not on duty"),
    INVALID_POSITION("INVALID_POSITION", 400, "Position is outside the valid range"),
    TOO_MANY_POINTS("TOO_MANY_POINTS", 400, "Too many points in one batch"),
    INVALID_RADIUS("INVALID_RADIUS", 400, "Search radius is out of range"),
    FORBIDDEN_FLEET_ACCESS("FORBIDDEN_FLEET_ACCESS", 403, "The live fleet is visible to dispatchers and support only");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    DispatchErrorCode(String code, int httpStatus, String defaultMessage) {
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
