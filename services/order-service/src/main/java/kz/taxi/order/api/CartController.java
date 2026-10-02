package kz.taxi.order.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.order.api.dto.CartDtos;
import kz.taxi.order.application.CartApplicationService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Customer cart API.
 *
 * <p>Thin on purpose: no business rules, no transaction, no locally invented status
 * code. The cart belongs to the caller of the token, always — there is no path
 * parameter that could name somebody else's cart, which is the cheapest way to make
 * an ownership bug impossible.
 *
 * <p>Every mutating endpoint answers with the whole cart, so a client that just
 * tapped "+" does not have to fetch it again.
 */
@RestController
@RequestMapping("/api/v1/cart")
@Tag(name = "Cart", description = "The editing buffer in front of a checkout")
public class CartController {

    private final CartApplicationService cartService;
    private final CurrentUser currentUser;

    public CartController(CartApplicationService cartService, CurrentUser currentUser) {
        this.cartService = cartService;
        this.currentUser = currentUser;
    }

    @GetMapping
    @Operation(summary = "Get the caller's cart",
            description = "Opens an empty active cart on first access. One active cart per user is enforced "
                    + "by a partial unique index, so a retried or concurrent call cannot produce two.")
    public CartDtos.CartResponse get() {
        return cartService.getCart(currentUser.requireUserId());
    }

    @PostMapping("/items")
    @Operation(summary = "Add a product to the cart",
            description = "The product is validated against the catalog and its title, image, price, merchant and "
                    + "currency are snapshotted. Adding the same product again adds to the existing line and "
                    + "refreshes the snapshot. Quantity is added to what the cart holds, 1..99 in total.")
    public CartDtos.CartResponse addItem(@Valid @RequestBody CartDtos.AddCartItemRequest request) {
        return cartService.addItem(currentUser.requireUserId(), request.productId(), request.quantity());
    }

    @PatchMapping("/items/{itemId}")
    @Operation(summary = "Set the quantity of a line",
            description = "Absolute quantity, 1..99. Anything else is INVALID_QUANTITY (400), a code a client can "
                    + "act on instead of parsing a validation message.")
    public CartDtos.CartResponse updateItem(@PathVariable String itemId,
                                           @Valid @RequestBody CartDtos.UpdateCartItemRequest request) {
        return cartService.updateItem(currentUser.requireUserId(), itemId, request.quantity());
    }

    @DeleteMapping("/items/{itemId}")
    @Operation(summary = "Remove a line from the cart")
    public CartDtos.CartResponse removeItem(@PathVariable String itemId) {
        return cartService.removeItem(currentUser.requireUserId(), itemId);
    }

    @DeleteMapping
    @Operation(summary = "Empty the cart",
            description = "Keeps the cart itself: the customer is still shopping, they just changed their mind.")
    public CartDtos.CartResponse clear() {
        return cartService.clear(currentUser.requireUserId());
    }
}
