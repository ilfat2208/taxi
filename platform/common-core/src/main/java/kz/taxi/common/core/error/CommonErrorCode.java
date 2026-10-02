package kz.taxi.common.core.error;

/** Technical, cross-cutting error codes shared by every service. */
public enum CommonErrorCode implements ErrorCode {

    VALIDATION_FAILED("VALIDATION_FAILED", 400, "Request validation failed"),
    BAD_REQUEST("BAD_REQUEST", 400, "Malformed request"),
    UNAUTHORIZED("UNAUTHORIZED", 401, "Authentication required"),
    FORBIDDEN("FORBIDDEN", 403, "Access denied"),
    NOT_FOUND("NOT_FOUND", 404, "Resource not found"),
    METHOD_NOT_ALLOWED("METHOD_NOT_ALLOWED", 405, "HTTP method not allowed"),
    CONFLICT("CONFLICT", 409, "Resource state conflict"),
    IDEMPOTENCY_CONFLICT("IDEMPOTENCY_CONFLICT", 409, "Idempotency key reused with a different payload"),
    PRECONDITION_FAILED("PRECONDITION_FAILED", 412, "Precondition failed"),
    RATE_LIMITED("RATE_LIMITED", 429, "Too many requests"),
    SERVICE_UNAVAILABLE("SERVICE_UNAVAILABLE", 503, "Downstream service unavailable"),
    INTERNAL_ERROR("INTERNAL_ERROR", 500, "Unexpected internal error");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    CommonErrorCode(String code, int httpStatus, String defaultMessage) {
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
