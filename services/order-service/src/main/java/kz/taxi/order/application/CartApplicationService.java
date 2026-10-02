package kz.taxi.order.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.order.api.dto.CartDtos;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartItem;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.ProductSnapshot;
import kz.taxi.order.infrastructure.CartItemRepository;
import kz.taxi.order.infrastructure.CartRepository;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.CatalogDtos;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Use cases a customer can run against their cart.
 *
 * <p>Three rules shape this service:
 *
 * <ul>
 *   <li><b>Every mutation returns the whole cart.</b> A client that just tapped
 *       "+" needs the new subtotal; making it re-fetch would be a second request
 *       that can fail on its own.</li>
 *   <li><b>A cart line is a snapshot.</b> The catalog is consulted when a product
 *       enters the cart and never again on read, so a catalog outage cannot empty
 *       somebody's cart — and a checkout re-validates everything anyway.</li>
 *   <li><b>A cart holds one currency.</b> The cart's currency follows its first
 *       line and a later product in another currency is refused up front, because
 *       a mixed cart can only fail much later, at the payment step.</li>
 * </ul>
 *
 * <p>The catalog read happens inside the transaction. It is a single small GET and
 * it runs before any write, so the alternative (two round trips with a
 * half-updated cart in between on failure) is worse than a connection held for a
 * few milliseconds.
 */
@Service
@Slf4j
public class CartApplicationService {

    private final ActiveCartProvider cartProvider;
    private final CartRepository cartRepository;
    private final CartItemRepository cartItemRepository;
    private final CatalogClient catalogClient;
    private final OrderMapper mapper;

    public CartApplicationService(ActiveCartProvider cartProvider,
                                  CartRepository cartRepository,
                                  CartItemRepository cartItemRepository,
                                  CatalogClient catalogClient,
                                  OrderMapper mapper) {
        this.cartProvider = cartProvider;
        this.cartRepository = cartRepository;
        this.cartItemRepository = cartItemRepository;
        this.catalogClient = catalogClient;
        this.mapper = mapper;
    }

    /** The cart contents, opening an empty cart on first access. */
    public record ActiveCart(Cart cart, List<CartItem> items) {

        public boolean isEmpty() {
            return items.isEmpty();
        }
    }

    // ------------------------------------------------------------------ reads

    @Transactional
    public CartDtos.CartResponse getCart(String userId) {
        Cart cart = cartProvider.requireActiveCart(userId);
        return mapper.toResponse(cart, itemsOf(cart));
    }

    /**
     * The cart a checkout is about to consume, or {@code CART_EMPTY}.
     *
     * <p>Unlike {@link #getCart} this does <em>not</em> open a cart: checking out
     * of an empty cart is a client mistake, and creating one to then reject it
     * would leave junk rows behind.
     */
    @Transactional(readOnly = true)
    public ActiveCart requireCheckoutCart(String userId) {
        Cart cart = cartProvider.findActiveCart(userId)
                .orElseThrow(CartApplicationService::cartIsEmpty);
        List<CartItem> items = itemsOf(cart);
        if (items.isEmpty()) {
            throw cartIsEmpty();
        }
        return new ActiveCart(cart, items);
    }

    // ------------------------------------------------------------------ mutations

    /**
     * Adds a product, or adds to the line that already holds it.
     *
     * <p>Re-adding refreshes the snapshot: the price and title the customer sees
     * must be the current ones, otherwise the cart silently shows yesterday's
     * price until the checkout refuses it.
     */
    @Transactional
    public CartDtos.CartResponse addItem(String userId, String productId, int quantity) {
        CartItem.validateQuantity(quantity);

        Cart cart = cartProvider.requireActiveCart(userId);
        List<CartItem> items = itemsOf(cart);
        Optional<CartItem> existing = items.stream()
                .filter(item -> item.getProductId().equals(productId))
                .findFirst();

        int resultingQuantity = existing
                .map(item -> Math.addExact(item.getQuantity(), quantity))
                .orElse(quantity);
        CartItem.validateQuantity(resultingQuantity);

        CatalogDtos.InternalProduct product = catalogClient.getProduct(productId);
        ProductSnapshot snapshot = snapshotOf(product, resultingQuantity, imageUrlOf(productId));

        if (existing.isPresent()) {
            existing.get().mergeWith(snapshot, quantity);
            cartItemRepository.save(existing.get());
        } else {
            requireOneCurrency(items, snapshot);
            if (items.isEmpty()) {
                // An empty cart adopts the currency of its first line: the column is
                // NOT NULL, so the cart was opened with a default guess.
                cart.adoptCurrency(snapshot.currency());
            }
            cartItemRepository.save(CartItem.of(cart.getId(), productId, snapshot, quantity));
        }

        cart.touch();
        cartRepository.save(cart);
        log.debug("user {} added {} x{} to cart {}", userId, productId, quantity, cart.getId());
        return mapper.toResponse(cart, itemsOf(cart));
    }

    /** Sets the absolute quantity of a line. */
    @Transactional
    public CartDtos.CartResponse updateItem(String userId, String itemId, int quantity) {
        Cart cart = cartProvider.requireActiveCart(userId);
        CartItem item = requireItem(cart, itemId);
        item.changeQuantity(quantity);
        cartItemRepository.save(item);
        cart.touch();
        cartRepository.save(cart);
        return mapper.toResponse(cart, itemsOf(cart));
    }

    @Transactional
    public CartDtos.CartResponse removeItem(String userId, String itemId) {
        Cart cart = cartProvider.requireActiveCart(userId);
        CartItem item = requireItem(cart, itemId);
        cartItemRepository.delete(item);
        cart.touch();
        cartRepository.save(cart);
        return mapper.toResponse(cart, itemsOf(cart));
    }

    @Transactional
    public CartDtos.CartResponse clear(String userId) {
        Cart cart = cartProvider.requireActiveCart(userId);
        List<CartItem> items = itemsOf(cart);
        if (!items.isEmpty()) {
            cartItemRepository.deleteAllInBatch(items);
        }
        cart.touch();
        cartRepository.save(cart);
        return mapper.toResponse(cart, List.of());
    }

    /**
     * The active cart that produced an order, when its lines still match exactly.
     *
     * <p>Used when a checkout is resumed: the order table has no {@code cart_id}, so
     * an order finalised by a retry does not know which cart it came from. An exact
     * match of every product and quantity is an identity, while "the customer's
     * active cart" would be a guess that could consume a brand new cart.
     */
    @Transactional(readOnly = true)
    public Optional<String> findMatchingActiveCartId(String userId, Map<String, Integer> linesByProduct) {
        return cartProvider.findActiveCart(userId)
                .filter(cart -> linesOf(cart).equals(linesByProduct))
                .map(Cart::getId);
    }

    /**
     * Consumes a cart once its order is paid.
     *
     * <p>Only the synchronous checkout can do this: the frozen order table has no
     * {@code cart_id}, so an order finalised later by the Kafka listener or the
     * recovery job does not know which cart it came from, and guessing "the
     * customer's active cart" would mark a brand new cart as checked out.
     */
    @Transactional
    public void markCheckedOut(String cartId) {
        cartRepository.findById(cartId).ifPresent(cart -> {
            if (cart.isActive()) {
                cart.checkOut();
                cartRepository.save(cart);
            }
        });
    }

    // ------------------------------------------------------------------ internals

    private List<CartItem> itemsOf(Cart cart) {
        return cartItemRepository.findByCartIdOrderByCreatedAtAsc(cart.getId());
    }

    private Map<String, Integer> linesOf(Cart cart) {
        Map<String, Integer> lines = new LinkedHashMap<>();
        for (CartItem item : itemsOf(cart)) {
            lines.merge(item.getProductId(), item.getQuantity(), Integer::sum);
        }
        return lines;
    }

    private CartItem requireItem(Cart cart, String itemId) {
        return cartItemRepository.findByIdAndCartId(itemId, cart.getId())
                .orElseThrow(() -> DomainException.of(OrderErrorCode.CART_ITEM_NOT_FOUND,
                                "cart item {} is not in your cart", itemId)
                        .withDetail("itemId", itemId)
                        .withDetail("cartId", cart.getId()));
    }

    /** The product has to be sellable, in stock, and priced in the cart's currency. */
    private ProductSnapshot snapshotOf(CatalogDtos.InternalProduct product, int requestedQuantity, String imageUrl) {
        if (!CatalogClient.isSellable(product.status())) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                            "product {} is not on sale ({})", product.id(), product.status())
                    .withDetail("productId", product.id())
                    .withDetail("productStatus", product.status());
        }
        if (product.availableQuantity() < requestedQuantity) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                            "only {} of {} are left, {} requested",
                            product.availableQuantity(), product.title(), requestedQuantity)
                    .withDetail("productId", product.id())
                    .withDetail("availableQuantity", product.availableQuantity())
                    .withDetail("requestedQuantity", requestedQuantity);
        }
        return new ProductSnapshot(product.merchantId(), product.title(), imageUrl,
                product.priceMinor(), parseCurrency(product.currency()));
    }

    private static void requireOneCurrency(List<CartItem> items, ProductSnapshot snapshot) {
        if (!items.isEmpty() && items.get(0).isQuotedIn(snapshot.currency())) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                            "a cart is paid for in one currency: it holds {} but this product is priced in {}",
                            items.get(0).getCurrency(), snapshot.currency())
                    .withDetail("cartCurrency", items.get(0).getCurrency().name())
                    .withDetail("productCurrency", snapshot.currency().name());
        }
    }

    private static Currency parseCurrency(String code) {
        try {
            return Currency.of(code);
        } catch (IllegalArgumentException unsupported) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                            "the catalog priced this product in an unsupported currency ({})", code)
                    .withDetail("currency", code);
        }
    }

    private String imageUrlOf(String productId) {
        String imageUrl = catalogClient.imageUrlOf(productId);
        return imageUrl == null || imageUrl.isBlank() ? null : imageUrl;
    }

    private static DomainException cartIsEmpty() {
        return DomainException.of(OrderErrorCode.CART_EMPTY, "the cart is empty, there is nothing to check out");
    }
}
