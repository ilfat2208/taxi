package kz.taxi.driver.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure this service can produce.
 *
 * <p>Codes are stable API surface: the driver app switches on them to decide what
 * to show (a missing document is a form to fill, a lost race for a trip is a
 * message), and the HTTP status is decided here rather than in a controller.
 */
public enum DriverErrorCode implements ErrorCode {

    DRIVER_NOT_FOUND("DRIVER_NOT_FOUND", 404, "Driver not found"),
    DRIVER_ALREADY_EXISTS("DRIVER_ALREADY_EXISTS", 409, "This user is already registered as a driver"),
    FORBIDDEN_DRIVER_ACCESS("FORBIDDEN_DRIVER_ACCESS", 403, "Driver profile belongs to another user"),
    INVALID_DRIVER("INVALID_DRIVER", 400, "Driver profile is not valid"),

    /** Going on duty without the required papers is refused, not warned about. */
    DRIVER_DOCUMENTS_INCOMPLETE("DRIVER_DOCUMENTS_INCOMPLETE", 422, "Required documents are missing"),
    /** An expired paper is as good as no paper — this is the whole point of storing expiry dates. */
    DRIVER_DOCUMENT_EXPIRED("DRIVER_DOCUMENT_EXPIRED", 422, "A required document has expired"),

    DRIVER_ALREADY_ON_DUTY("DRIVER_ALREADY_ON_DUTY", 409, "Driver is already on duty"),
    DRIVER_NOT_ON_DUTY("DRIVER_NOT_ON_DUTY", 409, "Driver is not on duty"),
    /** A driver cannot go off duty mid-trip: the rider is in the car. */
    DRIVER_ON_TRIP("DRIVER_ON_TRIP", 409, "Driver is performing a trip"),
    DRIVER_ALREADY_ON_TRIP("DRIVER_ALREADY_ON_TRIP", 409, "Driver already has an active trip"),
    DRIVER_HAS_NO_TRIP("DRIVER_HAS_NO_TRIP", 409, "Driver has no active trip");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    DriverErrorCode(String code, int httpStatus, String defaultMessage) {
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
