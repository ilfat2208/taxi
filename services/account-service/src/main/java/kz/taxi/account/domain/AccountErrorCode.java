package kz.taxi.account.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure this service can produce.
 *
 * <p>Codes are stable API surface: clients switch on them, dashboards aggregate
 * them, and the HTTP status is decided here rather than in a controller.
 */
public enum AccountErrorCode implements ErrorCode {

    ACCOUNT_NOT_FOUND("ACCOUNT_NOT_FOUND", 404, "Account not found"),
    ACCOUNT_NOT_ACTIVE("ACCOUNT_NOT_ACTIVE", 409, "Account is not active"),
    ACCOUNT_ALREADY_EXISTS("ACCOUNT_ALREADY_EXISTS", 409, "An account of this type and currency already exists"),
    FORBIDDEN_ACCOUNT_ACCESS("FORBIDDEN_ACCOUNT_ACCESS", 403, "Account belongs to another user"),
    INSUFFICIENT_FUNDS("INSUFFICIENT_FUNDS", 422, "Not enough available funds"),
    CURRENCY_MISMATCH("CURRENCY_MISMATCH", 400, "Currencies do not match"),
    HOLD_NOT_FOUND("HOLD_NOT_FOUND", 404, "Hold not found"),
    HOLD_NOT_ACTIVE("HOLD_NOT_ACTIVE", 409, "Hold is no longer active"),
    HOLD_EXPIRED("HOLD_EXPIRED", 409, "Hold has expired"),
    LIMIT_EXCEEDED("LIMIT_EXCEEDED", 422, "Amount exceeds the allowed limit"),
    VELOCITY_EXCEEDED("VELOCITY_EXCEEDED", 422, "Too many outgoing operations in a short period"),
    INVALID_AMOUNT("INVALID_AMOUNT", 400, "Amount must be positive"),
    LEDGER_INVARIANT_VIOLATION("LEDGER_INVARIANT_VIOLATION", 500, "Ledger posting is not balanced"),
    SYSTEM_ACCOUNT_UNAVAILABLE("SYSTEM_ACCOUNT_UNAVAILABLE", 503, "Platform suspense account is unavailable"),
    CONCURRENT_MODIFICATION("CONCURRENT_MODIFICATION", 409, "Account was modified concurrently, please retry");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    AccountErrorCode(String code, int httpStatus, String defaultMessage) {
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
