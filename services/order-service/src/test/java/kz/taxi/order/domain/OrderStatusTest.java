package kz.taxi.order.domain;

import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The order state machine, which is what keeps a late payment event from
 * resurrecting an order whose stock has already been released.
 */
class OrderStatusTest {

    @ParameterizedTest(name = "{0} -> {1} is allowed")
    @CsvSource({
            "DRAFT,PENDING_PAYMENT",
            "DRAFT,CANCELLED",
            "PENDING_PAYMENT,PAID",
            "PENDING_PAYMENT,CANCELLED",
            "PENDING_PAYMENT,FAILED",
            "PAID,CONFIRMED"
    })
    void legalTransitions(OrderStatus from, OrderStatus to) {
        assertThat(from.canTransitionTo(to)).isTrue();
    }

    @ParameterizedTest(name = "{0} -> {1} is refused")
    @CsvSource({
            "CANCELLED,PAID",
            "CANCELLED,PENDING_PAYMENT",
            "CANCELLED,CONFIRMED",
            "FAILED,PAID",
            "PAID,CANCELLED",
            "PAID,PENDING_PAYMENT",
            "PAID,FAILED",
            "CONFIRMED,CANCELLED",
            "CONFIRMED,PAID",
            "DRAFT,PAID"
    })
    void illegalTransitions(OrderStatus from, OrderStatus to) {
        assertThat(from.canTransitionTo(to)).isFalse();
    }

    @Test
    @DisplayName("money that moved cannot be un-moved by a status change")
    void paidIsNotCancellable() {
        assertThat(OrderStatus.PAID.canTransitionTo(OrderStatus.CANCELLED)).isFalse();
        assertThat(OrderStatus.PAID.canTransitionTo(OrderStatus.CONFIRMED)).isTrue();
    }

    @Test
    @DisplayName("a cancelled order has nowhere left to go")
    void cancelledIsFinal() {
        assertThat(OrderStatus.CANCELLED.isFinal()).isTrue();
        assertThat(OrderStatus.PENDING_PAYMENT.isFinal()).isFalse();
    }

    @ParameterizedTest
    @EnumSource(OrderStatus.class)
    void nullTargetIsNeverAllowed(OrderStatus status) {
        assertThat(status.canTransitionTo(null)).isFalse();
    }
}
