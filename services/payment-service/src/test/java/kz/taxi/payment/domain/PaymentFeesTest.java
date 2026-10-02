package kz.taxi.payment.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Fee arithmetic, and the invariant the database also enforces.
 *
 * <p>Everything here is in minor units and every expectation is an exact number:
 * a fee that is one tiyn off is a support ticket per thousand payments, and
 * "approximately right" is not a thing money can be.
 */
class PaymentFeesTest {

    private static final Currency KZT = Currency.KZT;

    @Test
    @DisplayName("the marketplace fee is basis points of the amount, and the total is amount plus fee")
    void merchant_fee_is_basis_points_of_the_amount() {
        PaymentFees.FeeBreakdown money = PaymentFees.forType(PaymentType.MERCHANT_PAYMENT,
                Money.ofMinor(100_000, KZT), 0L, 150L);

        assertThat(money.fee().minorUnits()).isEqualTo(1_500);
        assertThat(money.total().minorUnits()).isEqualTo(101_500);
        assertThat(money.total()).isEqualTo(money.amount().plus(money.fee()));
    }

    @Test
    @DisplayName("transfers are free: the total equals the amount")
    void transfers_have_no_fee_by_default() {
        PaymentFees.FeeBreakdown money = PaymentFees.forType(PaymentType.P2P_TRANSFER,
                Money.ofMinor(100_000, KZT), 0L, 150L);

        assertThat(money.fee().isZero()).isTrue();
        assertThat(money.total().minorUnits()).isEqualTo(100_000);
    }

    @ParameterizedTest(name = "{0} basis points of {1} minor units is {2}")
    @CsvSource({
            "150, 100000, 1500",
            "150, 333,    5",
            "150, 100,    2",
            "150, 33,     0",
            "10000, 12345, 12345",
            "0, 999999,   0"
    })
    @DisplayName("the fee rounds HALF_UP in minor units")
    void fee_rounding_is_half_up(long basisPoints, long amountMinor, long expectedFeeMinor) {
        PaymentFees.FeeBreakdown money = PaymentFees.compute(Money.ofMinor(amountMinor, KZT), basisPoints);

        assertThat(money.fee().minorUnits()).isEqualTo(expectedFeeMinor);
        assertThat(money.total().minorUnits()).isEqualTo(amountMinor + expectedFeeMinor);
    }

    @Test
    @DisplayName("total = amount + fee holds for every amount, in every currency")
    void total_amount_fee_invariant_always_holds() {
        long[] amounts = {1L, 2L, 99L, 100L, 333L, 1_234_567L, 999_999_999L};

        for (long amountMinor : amounts) {
            for (Currency currency : Currency.values()) {
                PaymentFees.FeeBreakdown money = PaymentFees.compute(Money.ofMinor(amountMinor, currency), 150L);

                assertThat(money.total().minorUnits())
                        .as("amount %s in %s", amountMinor, currency)
                        .isEqualTo(money.amount().minorUnits() + money.fee().minorUnits());
                assertThat(money.fee().currency()).isEqualTo(currency);
            }
        }
    }

    @Test
    @DisplayName("a non-positive amount is a business error, not arithmetic")
    void non_positive_amount_is_rejected() {
        assertThatThrownBy(() -> PaymentFees.compute(Money.ofMinor(0, KZT), 150L))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.INVALID_AMOUNT);
    }

    @Test
    @DisplayName("a negative fee rate is a configuration bug and fails loudly")
    void negative_rate_is_a_configuration_bug() {
        assertThatThrownBy(() -> PaymentFees.compute(Money.ofMinor(1_000, KZT), -1L))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("basis points");
    }

    @Test
    @DisplayName("a breakdown whose total does not add up cannot even be built")
    void inconsistent_breakdown_is_rejected() {
        assertThatThrownBy(() -> new PaymentFees.FeeBreakdown(
                Money.ofMinor(100_000, KZT), Money.ofMinor(1_500, KZT), Money.ofMinor(100_000, KZT)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("total must equal amount + fee");

        assertThatThrownBy(() -> new PaymentFees.FeeBreakdown(
                Money.ofMinor(100_000, KZT), Money.ofMinor(-1, KZT), Money.ofMinor(99_999, KZT)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("mixing currencies in a breakdown is refused")
    void mixed_currency_breakdown_is_refused() {
        assertThatThrownBy(() -> new PaymentFees.FeeBreakdown(
                Money.ofMinor(100_000, KZT), Money.ofMinor(1_500, Currency.USD), Money.ofMinor(101_500, KZT)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("currency");
    }

    @Test
    @DisplayName("the rate depends on the payment type")
    void rate_depends_on_the_type() {
        assertThat(PaymentFees.basisPointsFor(PaymentType.P2P_TRANSFER, 10L, 150L)).isEqualTo(10L);
        assertThat(PaymentFees.basisPointsFor(PaymentType.MERCHANT_PAYMENT, 10L, 150L)).isEqualTo(150L);
        assertThat(PaymentFees.basisPointsFor(PaymentType.REFUND, 10L, 150L)).isEqualTo(10L);
    }
}
