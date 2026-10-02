package kz.taxi.common.core.money;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MoneyTest {

    @Nested
    @DisplayName("factories")
    class Factories {

        @Test
        void creates_from_major_units() {
            Money money = Money.of(1_500, Currency.KZT);

            assertThat(money.minorUnits()).isEqualTo(150_000L);
            assertThat(money.toBigDecimal()).isEqualByComparingTo("1500.00");
        }

        @Test
        void creates_from_minor_units() {
            Money money = Money.ofMinor(150_050, Currency.KZT);

            assertThat(money.toBigDecimal()).isEqualByComparingTo("1500.50");
        }

        @Test
        void rounds_decimal_input_half_up() {
            assertThat(Money.ofDecimal(new BigDecimal("10.005"), Currency.KZT).minorUnits()).isEqualTo(1001L);
            assertThat(Money.ofDecimal(new BigDecimal("10.004"), Currency.KZT).minorUnits()).isEqualTo(1000L);
        }

        @Test
        void zero_has_no_value_but_keeps_currency() {
            assertThat(Money.zero(Currency.USD).isZero()).isTrue();
            assertThat(Money.zero(Currency.USD).currency()).isEqualTo(Currency.USD);
        }
    }

    @Nested
    @DisplayName("arithmetic")
    class Arithmetic {

        @Test
        void adds_and_subtracts_within_currency() {
            Money balance = Money.of(10_000, Currency.KZT);
            Money fee = Money.of(150, Currency.KZT);

            assertThat(balance.plus(fee)).isEqualTo(Money.of(10_150, Currency.KZT));
            assertThat(balance.minus(fee)).isEqualTo(Money.of(9_850, Currency.KZT));
        }

        @Test
        void applies_basis_point_percentage_with_half_up_rounding() {
            // 1.5% of 333.33 KZT = 4.99995 -> 5.00
            Money amount = Money.ofMinor(33_333, Currency.KZT);

            assertThat(amount.percentage(150)).isEqualTo(Money.ofMinor(500, Currency.KZT));
        }

        @Test
        void computes_zero_fee_for_zero_basis_points() {
            assertThat(Money.of(1_000, Currency.KZT).percentage(0).isZero()).isTrue();
        }

        @Test
        void rejects_mixing_currencies() {
            Money tenge = Money.of(100, Currency.KZT);
            Money dollars = Money.of(100, Currency.USD);

            assertThatThrownBy(() -> tenge.plus(dollars))
                    .isInstanceOf(CurrencyMismatchException.class)
                    .hasMessageContaining("KZT")
                    .hasMessageContaining("USD");
        }

        @Test
        void detects_overflow_instead_of_wrapping() {
            Money huge = Money.ofMinor(Long.MAX_VALUE, Currency.KZT);

            assertThatThrownBy(() -> huge.plus(Money.ofMinor(1, Currency.KZT)))
                    .isInstanceOf(ArithmeticException.class);
        }

        @Test
        void negate_and_abs_are_symmetric() {
            Money debit = Money.of(500, Currency.KZT).negate();

            assertThat(debit.negate()).isEqualTo(Money.of(500, Currency.KZT));
            assertThat(debit.abs()).isEqualTo(Money.of(500, Currency.KZT));
            assertThat(debit.isNegative()).isTrue();
        }
    }

    @Nested
    @DisplayName("comparison and rendering")
    class Comparison {

        @Test
        void compares_by_amount() {
            assertThat(Money.of(100, Currency.KZT).isGreaterThan(Money.of(99, Currency.KZT))).isTrue();
            assertThat(Money.of(100, Currency.KZT).isLessThan(Money.of(101, Currency.KZT))).isTrue();
            assertThat(Money.of(100, Currency.KZT).compareTo(Money.of(100, Currency.KZT))).isZero();
        }

        @Test
        void impossible_to_compare_across_currencies() {
            assertThatThrownBy(() -> Money.of(1, Currency.KZT).compareTo(Money.of(1, Currency.EUR)))
                    .isInstanceOf(CurrencyMismatchException.class);
        }

        @Test
        void renders_human_readable_value() {
            assertThat(Money.ofMinor(123_456, Currency.KZT).toString()).isEqualTo("1234.56 KZT");
        }
    }
}
