package kz.taxi.qtime.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure QTime can produce.
 *
 * <p>Codes are stable API surface: the verticals' apps switch on them to decide what
 * to show (a taken window is "выберите другое время", an out-of-hours request is a
 * bug in the client's own grid), and the HTTP status is decided here rather than in a
 * controller.
 *
 * <p>The 422 group is deliberate: those requests are well-formed and the caller is
 * allowed to make them — they simply cannot be satisfied by this calendar (the shop
 * is closed, the window is too far ahead, the slot is too soon). 400 means the caller
 * asked for something incoherent (a service that is not offered by that specialist),
 * 409 means somebody else got there first.
 */
public enum QtimeErrorCode implements ErrorCode {

    COMPANY_NOT_FOUND("COMPANY_NOT_FOUND", 404, "Company not found"),
    SPECIALIST_NOT_FOUND("SPECIALIST_NOT_FOUND", 404, "Specialist not found"),
    SERVICE_NOT_FOUND("SERVICE_NOT_FOUND", 404, "Service not found"),
    BOOKING_NOT_FOUND("BOOKING_NOT_FOUND", 404, "Booking not found"),

    INVALID_COMPANY("INVALID_COMPANY", 400, "Company data is not valid"),
    INVALID_SPECIALIST("INVALID_SPECIALIST", 400, "Specialist data is not valid"),
    INVALID_SERVICE("INVALID_SERVICE", 400, "Service data is not valid"),
    INVALID_BOOKING("INVALID_BOOKING", 400, "Booking data is not valid"),
    INVALID_WORKING_HOURS("INVALID_WORKING_HOURS", 400, "Working hours are not valid"),

    /** The specialist does not perform this service; a client bug, not a calendar fact. */
    SERVICE_NOT_OFFERED_BY_SPECIALIST("SERVICE_NOT_OFFERED_BY_SPECIALIST", 400,
            "This specialist does not provide the requested service"),

    /** A salon under review keeps its history but takes no new bookings. */
    COMPANY_NOT_AVAILABLE("COMPANY_NOT_AVAILABLE", 422, "Company is not accepting bookings"),
    /** The requested time is outside the shift, or the service does not fit inside it. */
    OUTSIDE_WORKING_HOURS("OUTSIDE_WORKING_HOURS", 422, "The requested time is outside working hours"),
    /** The window is in the past — the only honest answer to "запишите меня на вчера". */
    BOOKING_IN_PAST("BOOKING_IN_PAST", 422, "The requested time is in the past"),
    /** Too close to now: the master has to see the appointment before the client arrives. */
    BOOKING_TOO_SOON("BOOKING_TOO_SOON", 422, "The requested time is too soon"),
    /** Beyond the published horizon, or before today (for a slot grid query). */
    OUTSIDE_BOOKING_HORIZON("OUTSIDE_BOOKING_HORIZON", 422, "The requested date is outside the booking horizon"),

    /**
     * Somebody else took the window first.
     *
     * <p>Produced by the database (`booking_slot_unique`), not by a check in the
     * service: two clients tapping 15:30 at the same moment both pass every
     * application check, and only the index can decide between them.
     */
    SLOT_TAKEN("SLOT_TAKEN", 409, "This window has just been taken"),

    /** Cancelling or completing something that is already finished. */
    BOOKING_NOT_CANCELLABLE("BOOKING_NOT_CANCELLABLE", 409, "This booking can no longer be cancelled"),
    BOOKING_NOT_COMPLETABLE("BOOKING_NOT_COMPLETABLE", 409, "This booking cannot be completed"),

    /** The booking exists but belongs to somebody else. */
    FORBIDDEN_BOOKING_ACCESS("FORBIDDEN_BOOKING_ACCESS", 403, "This booking belongs to another user"),
    /** Only a client books. Merchants operate the calendar, which is a different surface. */
    CUSTOMER_ROLE_REQUIRED("CUSTOMER_ROLE_REQUIRED", 403, "Only a customer may create a booking");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    QtimeErrorCode(String code, int httpStatus, String defaultMessage) {
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
