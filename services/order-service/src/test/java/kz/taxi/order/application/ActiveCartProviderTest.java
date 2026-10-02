package kz.taxi.order.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartStatus;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.infrastructure.CartRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The one-active-cart rule and the race it creates.
 *
 * <p>The database index is the arbiter, so what is tested here is the losing side:
 * the request whose insert was refused must come back with the cart the other
 * request created, not with an error and not with a second cart.
 */
@ExtendWith(MockitoExtension.class)
class ActiveCartProviderTest {

    private static final String USER_ID = OrderFixtures.USER_ID;

    @Mock
    private CartRepository cartRepository;

    private ActiveCartProvider provider;

    @BeforeEach
    void setUp() {
        provider = new ActiveCartProvider(cartRepository);
    }

    @Test
    @DisplayName("an existing active cart is reused, never duplicated")
    void reusesTheExistingCart() {
        Cart existing = OrderFixtures.cart(USER_ID);
        when(cartRepository.findFirstByUserIdAndStatus(USER_ID, CartStatus.ACTIVE)).thenReturn(Optional.of(existing));

        assertThat(provider.requireActiveCart(USER_ID)).isSameAs(existing);
        verify(cartRepository, never()).saveAndFlush(org.mockito.ArgumentMatchers.any());
    }

    @Test
    @DisplayName("the first access opens a cart in the platform home currency")
    void opensACartOnFirstAccess() {
        when(cartRepository.findFirstByUserIdAndStatus(USER_ID, CartStatus.ACTIVE)).thenReturn(Optional.empty());
        when(cartRepository.saveAndFlush(org.mockito.ArgumentMatchers.any()))
                .thenAnswer(invocation -> invocation.getArgument(0));

        Cart cart = provider.requireActiveCart(USER_ID);

        assertThat(cart.getUserId()).isEqualTo(USER_ID);
        assertThat(cart.getStatus()).isEqualTo(CartStatus.ACTIVE);
        assertThat(cart.getCurrency()).isEqualTo(kz.taxi.common.core.money.Currency.KZT);
    }

    @Test
    @DisplayName("the loser of a concurrent create gets the winner's cart")
    void losesTheRaceGracefully() {
        Cart winner = OrderFixtures.cart(USER_ID);
        when(cartRepository.findFirstByUserIdAndStatus(USER_ID, CartStatus.ACTIVE))
                .thenReturn(Optional.empty(), Optional.of(winner));
        when(cartRepository.saveAndFlush(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new DataIntegrityViolationException("uq_cart_active_user"));

        assertThat(provider.requireActiveCart(USER_ID)).isSameAs(winner);
    }

    @Test
    @DisplayName("when the winner is not visible yet the caller is asked to retry, not handed two carts")
    void failsWithServiceUnavailableWhenTheRaceIsUnresolvable() {
        when(cartRepository.findFirstByUserIdAndStatus(USER_ID, CartStatus.ACTIVE)).thenReturn(Optional.empty());
        when(cartRepository.saveAndFlush(org.mockito.ArgumentMatchers.any()))
                .thenThrow(new DataIntegrityViolationException("uq_cart_active_user"));

        assertThatThrownBy(() -> provider.requireActiveCart(USER_ID))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode().code())
                .isEqualTo("SERVICE_UNAVAILABLE");
    }

    @Test
    @DisplayName("a checkout lookup never opens a cart")
    void findDoesNotCreate() {
        when(cartRepository.findFirstByUserIdAndStatus(USER_ID, CartStatus.ACTIVE)).thenReturn(Optional.empty());

        assertThat(provider.findActiveCart(USER_ID)).isEmpty();
        verify(cartRepository, never()).saveAndFlush(org.mockito.ArgumentMatchers.any());
    }
}
