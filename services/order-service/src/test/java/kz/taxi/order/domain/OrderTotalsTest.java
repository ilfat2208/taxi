package kz.taxi.order.domain;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.CurrencyMismatchException;
import kz.taxi.common.core.money.Money;
import kz.taxi.order.OrderFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The arithmetic of a checkout.
 *
 * <p>Money is the one thing in this service that must never be approximately right,
 * so the tests count actual minor units rather than asserting on shapes.
 */
class OrderTotalsTest {

    @Test
    @DisplayName("total = subtotal + delivery fee, in minor units")
    void addsTheDeliveryFee() {
        Money subtotal = Money.ofMinor(12_599L, Currency.KZT);

        OrderTotals totals = OrderTotals.of(subtotal, 990L);

        assertThat(totals.subtotalMinor()).isEqualTo(12_599L);
        assertThat(totals.deliveryFeeMinor()).isEqualTo(990L);
        assertThat(totals.totalMinor()).isEqualTo(13_589L);
        assertThat(totals.currency()).isEqualTo(Currency.KZT);
    }

    @Test
    @DisplayName("a zero fee means free delivery, and the total is the subtotal")
    void freeDelivery() {
        OrderTotals totals = OrderTotals.of(Money.ofMinor(5_000L, Currency.KZT), 0L);

        assertThat(totals.deliveryFee().isZero()).isTrue();
        assertThat(totals.totalMinor()).isEqualTo(5_000L);
    }

    @Test
    @DisplayName("line totals sum up, and one line's price does not leak into another")
    void sumsCartLines() {
        String cartId = "cart-1";

        OrderTotals totals = OrderTotals.ofCartItems(List.of(
                OrderFixtures.cartItem(cartId, "product-1", 1_500L, 2),
                OrderFixtures.cartItem(cartId, "product-2", 3_333L, 3)), 500L);

        assertThat(totals.subtotalMinor()).isEqualTo(1_500L * 2 + 3_333L * 3);
        assertThat(totals.totalMinor()).isEqualTo(totals.subtotalMinor() + 500L);
    }

    @Test
    @DisplayName("an empty cart has no total at all")
    void emptyCartHasNoTotal() {
        assertThatThrownBy(() -> OrderTotals.ofCartItems(List.of(), 0L))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CART_EMPTY);
    }

    @Test
    @DisplayName("a total that does not match its parts is rejected")
    void rejectsInconsistentTotal() {
        Money subtotal = Money.ofMinor(1_000L, Currency.KZT);

        assertThatThrownBy(() -> new OrderTotals(subtotal, Money.zero(Currency.KZT),
                Money.ofMinor(1_001L, Currency.KZT)))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(CommonErrorCode.VALIDATION_FAILED);
    }

    @Test
    @DisplayName("a negative delivery fee is rejected: a fee is never a discount")
    void rejectsNegativeFee() {
        assertThatThrownBy(() -> OrderTotals.of(Money.ofMinor(1_000L, Currency.KZT), -1L))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(CommonErrorCode.VALIDATION_FAILED);
    }

    @Test
    @DisplayName("mixing currencies fails loudly instead of producing a meaningless total")
    void refusesToMixCurrencies() {
        Money tenge = Money.ofMinor(1_000L, Currency.KZT);
        Money dollars = Money.ofMinor(1_000L, Currency.USD);

        assertThatThrownBy(() -> tenge.plus(dollars)).isInstanceOf(CurrencyMismatchException.class);
    }
}
