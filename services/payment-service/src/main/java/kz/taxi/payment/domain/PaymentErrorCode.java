package kz.taxi.payment.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure this service can produce.
 *
 * <p>Codes are stable API surface: clients switch on them and the HTTP status is
 * decided here rather than in a controller. The rule the enum encodes is that a
 * rejection coming from the account service (insufficient funds, a frozen
 * account, a missing hold) is <em>this</em> service's rejection too — it must
 * reach the caller as 4xx with a meaningful code, never as a 500.
 */
public enum PaymentErrorCode implements ErrorCode {

    PAYMENT_NOT_FOUND("PAYMENT_NOT_FOUND", 404, "Payment not found"),
    PAYMENT_ALREADY_COMPLETED("PAYMENT_ALREADY_COMPLETED", 409,
            "Payment is already in a settled state"),
    PAYMENT_NOT_COMPLETED("PAYMENT_NOT_COMPLETED", 409,
            "Payment has not completed and cannot be used this way"),
    PAYMENT_NOT_REVERSIBLE("PAYMENT_NOT_REVERSIBLE", 409,
            "Payment cannot be reversed from its current status"),
    REFUND_EXCEEDS_PAYMENT("REFUND_EXCEEDS_PAYMENT", 422,
            "Refund exceeds the amount still refundable on this payment"),
    TARGET_ACCOUNT_NOT_FOUND("TARGET_ACCOUNT_NOT_FOUND", 404,
            "No active account was found for the recipient"),
    SELF_TRANSFER_NOT_ALLOWED("SELF_TRANSFER_NOT_ALLOWED", 422,
            "Source and target accounts are the same"),
    INSUFFICIENT_FUNDS("INSUFFICIENT_FUNDS", 422, "Not enough available funds"),
    LIMIT_EXCEEDED("LIMIT_EXCEEDED", 422, "The operation exceeds a limit set for this account"),
    SOURCE_ACCOUNT_NOT_OWNED("SOURCE_ACCOUNT_NOT_OWNED", 403,
            "The source account does not belong to the caller"),
    HOLD_FAILED("HOLD_FAILED", 409, "Funds could not be reserved or moved"),
    DOWNSTREAM_UNAVAILABLE("DOWNSTREAM_UNAVAILABLE", 503,
            "The account service is unavailable, please retry"),
    ACCOUNT_SERVICE_ERROR("ACCOUNT_SERVICE_ERROR", 502,
            "The account service answered in a way this service cannot use"),
    INVALID_AMOUNT("INVALID_AMOUNT", 400, "Amount must be positive"),

    SETTLEMENT_NOT_FOUND("SETTLEMENT_NOT_FOUND", 404, "Settlement not found"),
    SETTLEMENT_ALREADY_PAID("SETTLEMENT_ALREADY_PAID", 409, "Settlement is already paid"),
    MERCHANT_PAYOUT_ACCOUNT_MISSING("MERCHANT_PAYOUT_ACCOUNT_MISSING", 422,
            "The merchant has not chosen a payout account yet"),
    MERCHANT_NOT_FOUND("MERCHANT_NOT_FOUND", 404, "Merchant not found"),
    CATALOG_SERVICE_ERROR("CATALOG_SERVICE_ERROR", 502, "Catalog service is unavailable");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    PaymentErrorCode(String code, int httpStatus, String defaultMessage) {
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
