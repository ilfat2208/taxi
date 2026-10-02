package kz.taxi.order.domain;

/**
 * How the payment service described the outcome of a payment attempt.
 *
 * <p>Anything the payment service answers that is not a known outcome becomes
 * {@link #UNKNOWN}: an unrecognised status must never be read as "failed" (that
 * would cancel an order whose money may have moved) nor as "completed" (that would
 * confirm an order nobody paid for).
 */
public enum PaymentStatus {

    /** Money moved. */
    COMPLETED,
    /** The payment was refused; nothing moved. */
    FAILED,
    /** The outcome is not known (unrecognised status, timeout, 5xx). */
    UNKNOWN;

    public static PaymentStatus parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return UNKNOWN;
        }
        return switch (raw.trim().toUpperCase()) {
            case "COMPLETED", "SUCCESS", "SUCCEEDED", "PAID" -> COMPLETED;
            case "FAILED", "DECLINED", "REJECTED", "ERROR" -> FAILED;
            default -> UNKNOWN;
        };
    }

    public boolean isCompleted() {
        return this == COMPLETED;
    }

    public boolean isFailed() {
        return this == FAILED;
    }

    public boolean isUnknown() {
        return this == UNKNOWN;
    }
}
