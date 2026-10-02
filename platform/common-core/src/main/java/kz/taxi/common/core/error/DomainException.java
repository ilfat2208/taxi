package kz.taxi.common.core.error;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Base class for every expected business failure.
 *
 * <p>Handlers never guess a status code from an exception type: the exception
 * carries an {@link ErrorCode}, so the mapping error-code -> HTTP status lives
 * in exactly one place. Unexpected (non-domain) exceptions are treated as
 * {@code INTERNAL_ERROR} and never leak their message to clients.
 */
public class DomainException extends RuntimeException {

    private final transient ErrorCode errorCode;
    private final Map<String, Object> details;

    protected DomainException(ErrorCode errorCode, String message, Map<String, Object> details) {
        super(message);
        this.errorCode = Objects.requireNonNull(errorCode, "errorCode must not be null");
        this.details = details == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(details));
    }

    // ------------------------------------------------------------------ factories

    public static DomainException of(ErrorCode errorCode, String message, Object... args) {
        return new DomainException(errorCode, format(message, args), null);
    }

    public static DomainException of(ErrorCode errorCode) {
        return new DomainException(errorCode, errorCode.defaultMessage(), null);
    }

    public static DomainException notFound(String message, Object... args) {
        return of(CommonErrorCode.NOT_FOUND, message, args);
    }

    public static DomainException conflict(String message, Object... args) {
        return of(CommonErrorCode.CONFLICT, message, args);
    }

    public static DomainException validation(String message, Object... args) {
        return of(CommonErrorCode.VALIDATION_FAILED, message, args);
    }

    public static DomainException forbidden(String message, Object... args) {
        return of(CommonErrorCode.FORBIDDEN, message, args);
    }

    public static DomainException unauthorized(String message, Object... args) {
        return of(CommonErrorCode.UNAUTHORIZED, message, args);
    }

    public static DomainException unavailable(String message, Object... args) {
        return of(CommonErrorCode.SERVICE_UNAVAILABLE, message, args);
    }

    // ------------------------------------------------------------------ api

    public ErrorCode errorCode() {
        return errorCode;
    }

    public Map<String, Object> details() {
        return details;
    }

    /** Adds structured context (ids, amounts) that helps clients and support. */
    public DomainException withDetail(String key, Object value) {
        Map<String, Object> merged = new LinkedHashMap<>(details);
        merged.put(key, value);
        return new DomainException(errorCode, getMessage(), merged);
    }

    /** Business failures are expected: no stack trace, cheaper to create. */
    @Override
    public synchronized Throwable fillInStackTrace() {
        return this;
    }

    private static String format(String template, Object... args) {
        if (template == null) {
            return null;
        }
        if (args == null || args.length == 0 || !template.contains("{}")) {
            return template;
        }
        StringBuilder out = new StringBuilder(template.length() + 32);
        int argIndex = 0;
        int cursor = 0;
        int placeholder;
        while (argIndex < args.length && (placeholder = template.indexOf("{}", cursor)) >= 0) {
            out.append(template, cursor, placeholder).append(args[argIndex++]);
            cursor = placeholder + 2;
        }
        out.append(template, cursor, template.length());
        return out.toString();
    }
}
