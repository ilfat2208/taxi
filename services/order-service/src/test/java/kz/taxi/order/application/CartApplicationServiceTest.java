package kz.taxi.order.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.CartDtos;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartItem;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.infrastructure.CartItemRepository;
import kz.taxi.order.infrastructure.CartRepository;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.CatalogDtos;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cart use cases: add, merge, update, remove, clear — and the ways they refuse.
 *
 * <p>The repositories are mocks and the mapper is the real one, so the assertions
 * check what a client would actually see (subtotals, quantities, codes) rather than
 * that a method was called.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CartApplicationServiceTest {

    private static final String USER_ID = OrderFixtures.USER_ID;
    private static final String PRODUCT_ID = "product-1";

    @Mock
    private ActiveCartProvider cartProvider;
    @Mock
    private CartRepository cartRepository;
    @Mock
    private CartItemRepository cartItemRepository;
    @Mock
    private CatalogClient catalogClient;

    private CartApplicationService cartService;
    private Cart cart;
    /** What the (mocked) table holds for this cart. */
    private final List<CartItem> stored = new ArrayList<>();

    @BeforeEach
    void setUp() {
        cartService = new CartApplicationService(cartProvider, cartRepository, cartItemRepository,
                catalogClient, new OrderMapper());
        cart = OrderFixtures.cart(USER_ID);
        stored.clear();
        when(cartProvider.requireActiveCart(USER_ID)).thenReturn(cart);
        when(cartProvider.findActiveCart(USER_ID)).thenReturn(Optional.of(cart));
        when(cartItemRepository.findByCartIdOrderByCreatedAtAsc(cart.getId()))
                .thenAnswer(invocation -> List.copyOf(stored));
        when(cartItemRepository.save(any(CartItem.class))).thenAnswer(invocation -> {
            CartItem item = invocation.getArgument(0);
            stored.removeIf(existing -> existing.getId().equals(item.getId()));
            stored.add(item);
            return item;
        });
        org.mockito.Mockito.doAnswer(invocation -> {
            stored.remove(invocation.getArgument(0, CartItem.class));
            return null;
        }).when(cartItemRepository).delete(any(CartItem.class));
        org.mockito.Mockito.doAnswer(invocation -> {
            stored.removeAll(invocation.getArgument(0, List.class));
            return null;
        }).when(cartItemRepository).deleteAllInBatch(any());
    }

    // ------------------------------------------------------------------ add

    @Test
    @DisplayName("adding a product snapshots its price, title, merchant and image")
    void addItemSnapshotsTheProduct() {
        givenProduct(1_500L, "ACTIVE", 10, "https://cdn.test/product-1.png");

        CartDtos.CartResponse response = cartService.addItem(USER_ID, PRODUCT_ID, 2);

        assertThat(stored).hasSize(1);
        CartItem item = stored.get(0);
        assertThat(item.getQuantity()).isEqualTo(2);
        assertThat(item.getUnitPriceMinor()).isEqualTo(1_500L);
        assertThat(item.getMerchantId()).isEqualTo(OrderFixtures.MERCHANT_ID);
        assertThat(item.getTitle()).isEqualTo("Title " + PRODUCT_ID);
        assertThat(item.getImageUrl()).isEqualTo("https://cdn.test/product-1.png");
        assertThat(item.getCurrency()).isEqualTo(Currency.KZT);

        assertThat(response.items()).hasSize(1);
        assertThat(response.subtotalMinor()).isEqualTo(3_000L);
        assertThat(response.itemCount()).isEqualTo(2);
        assertThat(response.currency()).isEqualTo("KZT");
    }

    @Test
    @DisplayName("adding the same product again merges the line and refreshes the snapshot")
    void addItemMergesAndRefreshes() {
        CartItem existing = OrderFixtures.cartItem(cart.getId(), PRODUCT_ID, 1_000L, 1);
        stored.add(existing);
        givenProduct(1_200L, "ACTIVE", 10, null);

        CartDtos.CartResponse response = cartService.addItem(USER_ID, PRODUCT_ID, 2);

        assertThat(stored).hasSize(1);
        assertThat(stored.get(0).getId()).isEqualTo(existing.getId());
        assertThat(stored.get(0).getQuantity()).isEqualTo(3);
        assertThat(stored.get(0).getUnitPriceMinor()).isEqualTo(1_200L);
        assertThat(response.subtotalMinor()).isEqualTo(3_600L);
    }

    @Test
    @DisplayName("a quantity outside 1..99 is refused before the catalog is called")
    void addItemRejectsAnInvalidQuantity() {
        for (int quantity : new int[]{0, -1, 100}) {
            assertThatThrownBy(() -> cartService.addItem(USER_ID, PRODUCT_ID, quantity))
                    .isInstanceOf(DomainException.class)
                    .extracting(failure -> ((DomainException) failure).errorCode())
                    .isEqualTo(OrderErrorCode.INVALID_QUANTITY);
        }
        verify(catalogClient, never()).getProduct(anyString());
    }

    @Test
    @DisplayName("a product that is not on sale cannot enter a cart")
    void addItemRejectsAnUnpublishedProduct() {
        givenProduct(1_000L, "DRAFT", 10, null);

        assertThatThrownBy(() -> cartService.addItem(USER_ID, PRODUCT_ID, 1))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);
        assertThat(stored).isEmpty();
    }

    @Test
    @DisplayName("asking for more than the catalog has is refused up front")
    void addItemRejectsInsufficientStock() {
        givenProduct(1_000L, "ACTIVE", 1, null);

        assertThatThrownBy(() -> cartService.addItem(USER_ID, PRODUCT_ID, 3))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);
    }

    @Test
    @DisplayName("the resulting quantity is checked, not just the added one")
    void addItemChecksTheMergedQuantity() {
        stored.add(OrderFixtures.cartItem(cart.getId(), PRODUCT_ID, 1_000L, 98));

        assertThatThrownBy(() -> cartService.addItem(USER_ID, PRODUCT_ID, 5))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.INVALID_QUANTITY);
        verify(catalogClient, never()).getProduct(anyString());
    }

    // ------------------------------------------------------------------ update / remove / clear

    @Test
    @DisplayName("updating sets an absolute quantity")
    void updateItemSetsTheQuantity() {
        CartItem item = OrderFixtures.cartItem(cart.getId(), PRODUCT_ID, 1_000L, 1);
        stored.add(item);
        when(cartItemRepository.findByIdAndCartId(item.getId(), cart.getId())).thenReturn(Optional.of(item));

        CartDtos.CartResponse response = cartService.updateItem(USER_ID, item.getId(), 5);

        assertThat(item.getQuantity()).isEqualTo(5);
        assertThat(response.subtotalMinor()).isEqualTo(5_000L);
    }

    @Test
    @DisplayName("a line of somebody else's cart is indistinguishable from a missing one")
    void updateItemRejectsAnUnknownLine() {
        when(cartItemRepository.findByIdAndCartId("other-item", cart.getId())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> cartService.updateItem(USER_ID, "other-item", 2))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CART_ITEM_NOT_FOUND);
    }

    @Test
    void removesALine() {
        CartItem item = OrderFixtures.cartItem(cart.getId(), PRODUCT_ID, 1_000L, 1);
        stored.add(item);
        when(cartItemRepository.findByIdAndCartId(item.getId(), cart.getId())).thenReturn(Optional.of(item));

        CartDtos.CartResponse response = cartService.removeItem(USER_ID, item.getId());

        assertThat(stored).isEmpty();
        assertThat(response.items()).isEmpty();
        assertThat(response.subtotalMinor()).isZero();
    }

    @Test
    @DisplayName("clearing removes every line and keeps the cart")
    void clearsTheCart() {
        stored.add(OrderFixtures.cartItem(cart.getId(), "product-1", 1_000L, 1));
        stored.add(OrderFixtures.cartItem(cart.getId(), "product-2", 2_000L, 2));

        CartDtos.CartResponse response = cartService.clear(USER_ID);

        assertThat(stored).isEmpty();
        assertThat(response.items()).isEmpty();
        assertThat(response.cartId()).isEqualTo(cart.getId());
    }

    // ------------------------------------------------------------------ checkout hand-off

    @Test
    @DisplayName("checkout of an empty cart is refused, and no cart is created for it")
    void checkoutOfAnEmptyCartFails() {
        assertThatThrownBy(() -> cartService.requireCheckoutCart(USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CART_EMPTY);
        verify(cartProvider, never()).requireActiveCart(USER_ID);
    }

    @Test
    @DisplayName("a user without a cart has nothing to check out")
    void checkoutWithoutACartFails() {
        when(cartProvider.findActiveCart(USER_ID)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> cartService.requireCheckoutCart(USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CART_EMPTY);
    }

    @Test
    @DisplayName("checkout returns the cart and its lines")
    void checkoutReturnsTheCart() {
        stored.add(OrderFixtures.cartItem(cart.getId(), PRODUCT_ID, 1_000L, 2));

        CartApplicationService.ActiveCart active = cartService.requireCheckoutCart(USER_ID);

        assertThat(active.cart().getId()).isEqualTo(cart.getId());
        assertThat(active.items()).hasSize(1);
        assertThat(active.isEmpty()).isFalse();
    }

    @Test
    @DisplayName("the cart that produced an order is recognised by its exact lines")
    void matchingCartIdRequiresExactLines() {
        stored.add(OrderFixtures.cartItem(cart.getId(), PRODUCT_ID, 1_000L, 2));

        assertThat(cartService.findMatchingActiveCartId(USER_ID, java.util.Map.of(PRODUCT_ID, 2)))
                .contains(cart.getId());
        assertThat(cartService.findMatchingActiveCartId(USER_ID, java.util.Map.of(PRODUCT_ID, 3))).isEmpty();
        assertThat(cartService.findMatchingActiveCartId(USER_ID, java.util.Map.of("other", 2))).isEmpty();
    }

    private void givenProduct(long priceMinor, String status, int availableQuantity, String imageUrl) {
        when(catalogClient.getProduct(PRODUCT_ID)).thenReturn(new CatalogDtos.InternalProduct(
                PRODUCT_ID, OrderFixtures.MERCHANT_ID, "Title " + PRODUCT_ID, priceMinor, "KZT",
                status, availableQuantity));
        when(catalogClient.imageUrlOf(PRODUCT_ID)).thenReturn(imageUrl);
    }
}
