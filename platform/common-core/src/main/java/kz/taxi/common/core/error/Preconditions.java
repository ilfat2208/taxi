package kz.taxi.common.core.error;

import java.util.Collection;

/** Guard clauses that fail with a typed {@link DomainException}. */
public final class Preconditions {

    private Preconditions() {
    }

    public static void check(boolean condition, ErrorCode errorCode, String message, Object... args) {
        if (!condition) {
            throw DomainException.of(errorCode, message, args);
        }
    }

    public static void checkArgument(boolean condition, String message, Object... args) {
        check(condition, CommonErrorCode.VALIDATION_FAILED, message, args);
    }

    public static <T> T requireNotNull(T value, ErrorCode errorCode, String message, Object... args) {
        check(value != null, errorCode, message, args);
        return value;
    }

    public static <T> T requireNotNull(T value, String message, Object... args) {
        return requireNotNull(value, CommonErrorCode.NOT_FOUND, message, args);
    }

    public static String requireText(String value, String field) {
        check(value != null && !value.isBlank(), CommonErrorCode.VALIDATION_FAILED,
                "{} must not be blank", field);
        return value;
    }

    public static long requirePositive(long value, String field) {
        check(value > 0, CommonErrorCode.VALIDATION_FAILED, "{} must be positive", field);
        return value;
    }

    public static long requireNotNegative(long value, String field) {
        check(value >= 0, CommonErrorCode.VALIDATION_FAILED, "{} must not be negative", field);
        return value;
    }

    public static <T extends Collection<?>> T requireNotEmpty(T value, String field) {
        check(value != null && !value.isEmpty(), CommonErrorCode.VALIDATION_FAILED,
                "{} must not be empty", field);
        return value;
    }
}
