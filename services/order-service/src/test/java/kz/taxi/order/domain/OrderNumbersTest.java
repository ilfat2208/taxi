package kz.taxi.order.domain;

import kz.taxi.order.api.dto.OrderDtos;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Order numbers and the keys derived from the order id.
 *
 * <p>The idempotency keys are tested because they are the reason a retried checkout
 * cannot charge twice: if they ever became random, the bug would only show up under
 * a retry in production.
 */
class OrderNumbersTest {

    @Test
    @DisplayName("an order number reads like a sequence")
    void formatsReadableNumber() {
        assertThat(OrderNumbers.format(LocalDate.of(2025, 1, 1), 42L)).isEqualTo("ORD-250101-00042");
        assertThat(OrderNumbers.format(LocalDate.of(2025, 12, 31), 7L)).isEqualTo("ORD-251231-00007");
    }

    @Test
    @DisplayName("the payment key is derived from the order id and the merchant, so each seller has their own")
    void paymentKeyIsDerivedFromTheOrderAndTheMerchant() {
        assertThat(OrderNumbers.paymentIdempotencyKey("01HZZZ", "merchant-1"))
                .isEqualTo("ORD-01HZZZ-PAY-merchant-1");
        assertThat(OrderNumbers.paymentIdempotencyKey("01HZZZ", "merchant-2"))
                .isNotEqualTo(OrderNumbers.paymentIdempotencyKey("01HZZZ", "merchant-1"));
        assertThat(OrderNumbers.paymentIdempotencyKey("01HZZZ", "merchant-1"))
                .isEqualTo(OrderNumbers.paymentIdempotencyKey("01HZZZ", "merchant-1"));
    }

    @Test
    void refundKeysAreDistinctFromThePaymentKeys() {
        assertThat(OrderNumbers.refundIdempotencyKey("01HZZZ", "merchant-1"))
                .isEqualTo("ORD-01HZZZ-REFUND-merchant-1")
                .isNotEqualTo(OrderNumbers.paymentIdempotencyKey("01HZZZ", "merchant-1"));
        // The key of one merchant's refund must not collide with another's: a retried
        // compensation refunds each seller once.
        assertThat(OrderNumbers.refundIdempotencyKey("01HZZZ", "merchant-2"))
                .isNotEqualTo(OrderNumbers.refundIdempotencyKey("01HZZZ", "merchant-1"));
        // Orders created before split payments keep the key they always had.
        assertThat(OrderNumbers.refundIdempotencyKey("01HZZZ")).isEqualTo("ORD-01HZZZ-REFUND");
    }

    @Test
    @DisplayName("a stored failure round-trips, so a retried checkout gets the same answer")
    void failureRoundTrip() {
        OrderFailure failure = OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED, "insufficient funds");

        String stored = failure.encode();
        OrderFailure read = OrderFailure.decode(stored).orElseThrow();

        assertThat(stored).isEqualTo("PAYMENT_DECLINED: insufficient funds");
        assertThat(read.code()).isEqualTo(OrderErrorCode.PAYMENT_DECLINED);
        assertThat(read.message()).isEqualTo("insufficient funds");
    }

    @Test
    @DisplayName("a plain cancellation reason carries no error code")
    void plainReasonHasNoCode() {
        assertThat(OrderFailure.decode("cancelled by the customer")).isEmpty();
        assertThat(OrderFailure.decode("SOMETHING_ELSE: whatever")).isEmpty();
        assertThat(OrderFailure.decode(null)).isEmpty();
    }

    @Test
    @DisplayName("the stored reason fits the column it is written to")
    void reasonIsTruncatedToTheColumnWidth() {
        String stored = OrderFailure.of(OrderErrorCode.CATALOG_ERROR, "x".repeat(2_000)).encode();

        assertThat(stored).hasSize(OrderFailure.MAX_STORED_LENGTH);
        assertThat(stored).startsWith("CATALOG_ERROR: ");
    }

    @Test
    @DisplayName("error codes carry the HTTP status the platform renders")
    void errorCodesCarryStatuses() {
        assertThat(OrderErrorCode.ORDER_NOT_FOUND.httpStatus()).isEqualTo(404);
        assertThat(OrderErrorCode.CART_EMPTY.httpStatus()).isEqualTo(422);
        assertThat(OrderErrorCode.PAYMENT_PENDING.httpStatus()).isEqualTo(409);
        assertThat(OrderErrorCode.ORDER_NOT_CANCELLABLE.httpStatus()).isEqualTo(409);
        assertThat(OrderErrorCode.PRODUCT_UNAVAILABLE.httpStatus()).isEqualTo(409);
        assertThat(OrderErrorCode.PAYMENT_DECLINED.httpStatus()).isEqualTo(422);
        assertThat(OrderErrorCode.DOWNSTREAM_UNAVAILABLE.httpStatus()).isEqualTo(503);
        assertThat(OrderErrorCode.CATALOG_ERROR.httpStatus()).isEqualTo(502);
        assertThat(OrderErrorCode.PAYMENT_SERVICE_ERROR.httpStatus()).isEqualTo(502);
        assertThat(OrderErrorCode.INVALID_QUANTITY.httpStatus()).isEqualTo(400);
        assertThat(OrderErrorCode.CART_ITEM_NOT_FOUND.httpStatus()).isEqualTo(404);
    }

    @Test
    @DisplayName("the checkout response exposes the saga state, not just the status")
    void checkoutResponseKeepsSagaState() {
        OrderDtos.OrderResponse response = new OrderDtos.OrderResponse("order-1", "ORD-250101-00001",
                "PENDING_PAYMENT", "PAYMENT_UNKNOWN", "KZT", 1_000L, 0L, 1_000L,
                null, null, "payment did not answer", null, null, null, 0,
                java.util.List.of(), java.util.List.of(), java.util.List.of(), null, null, null);

        assertThat(response.sagaState()).isEqualTo("PAYMENT_UNKNOWN");
        assertThat(response.status()).isEqualTo("PENDING_PAYMENT");
    }
}
