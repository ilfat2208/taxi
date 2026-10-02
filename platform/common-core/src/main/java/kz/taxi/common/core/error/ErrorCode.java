package kz.taxi.common.core.error;

/**
 * Machine-readable error contract.
 *
 * <p>Every business failure the platform can produce is enumerated in an enum
 * implementing this interface. Clients switch on {@link #code()}, humans read
 * the message, and the HTTP status is never invented at the controller layer.
 */
public interface ErrorCode {

    /** Stable, SCREAMING_SNAKE code exposed to clients and dashboards. */
    String code();

    /** HTTP status to use when this error escapes to the REST boundary. */
    int httpStatus();

    /** Default human-readable message, used when no specific message applies. */
    String defaultMessage();
}
