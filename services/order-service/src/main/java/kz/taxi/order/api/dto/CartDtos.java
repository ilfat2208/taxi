package kz.taxi.order.api.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * Cart API payloads.
 *
 * <p>The quantity range is enforced in {@link kz.taxi.order.domain.CartItem}
 * rather than with bean validation: a client has to be able to tell "you asked for
 * 0 items" ({@code INVALID_QUANTITY}) from "your request was malformed"
 * ({@code VALIDATION_FAILED}), and only the domain knows the difference.
 */
public final class CartDtos {

    private CartDtos() {
    }

    /**
     * Adds a product to the cart.
     *
     * <p>{@code quantity} is added to whatever the cart already holds for that
     * product; the price and title snapshot is refreshed at the same time.
     */
    public record AddCartItemRequest(@NotNull @Size(max = 26) String productId, @NotNull Integer quantity) {
    }

    /** Sets the absolute quantity of an existing line. */
    public record UpdateCartItemRequest(@NotNull Integer quantity) {
    }

    public record CartItemResponse(String itemId,
                                   String productId,
                                   String merchantId,
                                   String title,
                                   String imageUrl,
                                   long unitPriceMinor,
                                   int quantity,
                                   long lineTotalMinor,
                                   String currency) {
    }

    /**
     * The whole cart, returned by every mutation.
     *
     * <p>Deliberate: a cart page needs the new subtotal and item count after each
     * tap, and re-fetching would be a second round trip that can fail on its own.
     */
    public record CartResponse(String cartId,
                               String status,
                               String currency,
                               int itemCount,
                               long subtotalMinor,
                               List<CartItemResponse> items,
                               Instant updatedAt) {
    }
}
