package kz.taxi.order.domain;

import java.util.Optional;

/**
 * A checkout failure, in the one form that survives a restart.
 *
 * <p>The frozen order table has {@code failure_reason} but no {@code failure_code}
 * column, yet a client that retries a declined checkout must get the same answer
 * as the first attempt (the idempotency key is released when an action throws, so
 * the second attempt really does reach this service). Both facts are satisfied by
 * encoding the code into the stored reason as {@code CODE: human readable text},
 * which is still a perfectly readable column for support.
 *
 * @param code    the error code the caller will see
 * @param message what a human should read
 */
public record OrderFailure(OrderErrorCode code, String message) {

    /** Column width of {@code customer_order.failure_reason}. */
    public static final int MAX_STORED_LENGTH = 512;

    private static final String SEPARATOR = ": ";

    public OrderFailure {
        if (code == null) {
            throw new IllegalArgumentException("code must not be null");
        }
        message = message == null || message.isBlank() ? code.defaultMessage() : message.trim();
    }

    public static OrderFailure of(OrderErrorCode code, String message) {
        return new OrderFailure(code, message);
    }

    /** The value written to {@code customer_order.failure_reason}, truncated to fit. */
    public String encode() {
        String encoded = code.code() + SEPARATOR + message;
        return encoded.length() <= MAX_STORED_LENGTH ? encoded : encoded.substring(0, MAX_STORED_LENGTH);
    }

    /** Reads a stored reason back; empty when the column holds a plain message. */
    public static Optional<OrderFailure> decode(String stored) {
        if (stored == null || stored.isBlank()) {
            return Optional.empty();
        }
        int separator = stored.indexOf(SEPARATOR);
        if (separator <= 0) {
            return Optional.empty();
        }
        String head = stored.substring(0, separator);
        String tail = stored.substring(separator + SEPARATOR.length()).trim();
        for (OrderErrorCode candidate : OrderErrorCode.values()) {
            if (candidate.code().equals(head)) {
                return Optional.of(new OrderFailure(candidate, tail));
            }
        }
        return Optional.empty();
    }
}
