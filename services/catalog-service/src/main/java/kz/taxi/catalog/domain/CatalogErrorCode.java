package kz.taxi.catalog.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure the catalog can produce.
 *
 * <p>Codes are stable API surface: the order service switches on them to decide
 * whether a checkout is recoverable ({@code INSUFFICIENT_STOCK}) or fatal
 * ({@code PRODUCT_NOT_FOUND}), clients show them to merchants, and the HTTP
 * status is decided here instead of in a controller.
 *
 * <p>The wording of {@link #defaultMessage()} is deliberately merchant-facing:
 * {@code STOCK_ADJUSTMENT_INVALID} has to tell a merchant what to do next, not
 * name the CHECK constraint that rejected the write.
 */
public enum CatalogErrorCode implements ErrorCode {

    PRODUCT_NOT_FOUND("PRODUCT_NOT_FOUND", 404, "Product not found"),
    PRODUCT_NOT_AVAILABLE("PRODUCT_NOT_AVAILABLE", 409, "Product is not available for sale"),
    DUPLICATE_SKU("DUPLICATE_SKU", 409, "A product with this SKU already exists for the merchant"),
    MERCHANT_NOT_FOUND("MERCHANT_NOT_FOUND", 404, "Merchant not found"),
    MERCHANT_ALREADY_EXISTS("MERCHANT_ALREADY_EXISTS", 409, "The caller already has a merchant profile"),
    NOT_MERCHANT_OWNER("NOT_MERCHANT_OWNER", 403, "Product belongs to another merchant"),
    INSUFFICIENT_STOCK("INSUFFICIENT_STOCK", 409, "Not enough stock available"),
    RESERVATION_NOT_FOUND("RESERVATION_NOT_FOUND", 404, "Stock reservation not found"),
    RESERVATION_NOT_ACTIVE("RESERVATION_NOT_ACTIVE", 409, "Reservation is no longer active"),
    MIXED_CURRENCIES("MIXED_CURRENCIES", 400, "All items of one reservation must share a currency"),
    STOCK_ADJUSTMENT_INVALID("STOCK_ADJUSTMENT_INVALID", 422,
            "Stock adjustment would leave less on hand than is reserved"),
    INVALID_QUANTITY("INVALID_QUANTITY", 400, "Quantity must be a whole number between 1 and 99");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    CatalogErrorCode(String code, int httpStatus, String defaultMessage) {
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
