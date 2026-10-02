package kz.taxi.order.domain;

import kz.taxi.common.core.error.ErrorCode;

/**
 * Every business failure the order service can produce.
 *
 * <p>The enum pairs each code with its HTTP status, so no controller ever picks a
 * status: the status is a property of the failure, not of the endpoint that
 * happened to raise it.
 *
 * <p>The two "bad gateway" codes are deliberately distinct from
 * {@link #DOWNSTREAM_UNAVAILABLE}: a downstream service that <em>answered with an
 * error</em> is a different incident (its logs hold the reason) from one that
 * <em>did not answer at all</em> (a timeout or a connection failure). The checkout
 * saga treats the second case as an indeterminate outcome and compensates,
 * because "no answer" may still mean the remote side did the work.
 */
public enum OrderErrorCode implements ErrorCode {

    ORDER_NOT_FOUND("ORDER_NOT_FOUND", 404, "Order not found"),
    CART_EMPTY("CART_EMPTY", 422, "The cart is empty, there is nothing to check out"),
    CART_ITEM_NOT_FOUND("CART_ITEM_NOT_FOUND", 404, "Cart item not found"),
    ORDER_NOT_CANCELLABLE("ORDER_NOT_CANCELLABLE", 409, "The order cannot be cancelled in its current state"),
    PRODUCT_UNAVAILABLE("PRODUCT_UNAVAILABLE", 409, "The product is not available in the requested quantity"),
    PAYMENT_DECLINED("PAYMENT_DECLINED", 422, "The payment was declined"),
    PAYMENT_PENDING("PAYMENT_PENDING", 409, "The payment outcome is not known yet, the order cannot be cancelled"),
    DOWNSTREAM_UNAVAILABLE("DOWNSTREAM_UNAVAILABLE", 503, "A required service did not answer"),
    CATALOG_ERROR("CATALOG_ERROR", 502, "The catalog service answered with an error"),
    PAYMENT_SERVICE_ERROR("PAYMENT_SERVICE_ERROR", 502, "The payment service answered with an error"),
    INVALID_QUANTITY("INVALID_QUANTITY", 400, "Quantity must be a whole number between 1 and 99");

    private final String code;
    private final int httpStatus;
    private final String defaultMessage;

    OrderErrorCode(String code, int httpStatus, String defaultMessage) {
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
