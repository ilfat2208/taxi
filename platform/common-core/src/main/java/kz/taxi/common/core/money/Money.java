package kz.taxi.common.core.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * Immutable monetary value stored in minor units as a {@code long}.
 *
 * <p>Never use {@code double} for money. Minor units (tiyn for KZT, cents for
 * USD) make the ledger exact, make database columns {@code BIGINT}, and remove
 * every rounding question from the hot path of payments.
 *
 * <pre>{@code
 * Money fee = Money.of(500, Currency.KZT);      // 500.00 KZT
 * Money total = balance.plus(fee);
 * total.toBigDecimal();                          // 500.00
 * }</pre>
 */
public record Money(long minorUnits, Currency currency) implements Comparable<Money> {

    public Money {
        Objects.requireNonNull(currency, "currency must not be null");
    }

    // ------------------------------------------------------------------ factories

    /** Creates money from major units: {@code of(1_500, KZT) == 1 500.00 KZT}. */
    public static Money of(long majorUnits, Currency currency) {
        return new Money(Math.multiplyExact(majorUnits, currency.minorFactor()), currency);
    }

    /** Creates money from minor units: {@code ofMinor(150_050, KZT) == 1 500.50 KZT}. */
    public static Money ofMinor(long minorUnits, Currency currency) {
        return new Money(minorUnits, currency);
    }

    public static Money zero(Currency currency) {
        return new Money(0L, currency);
    }

    /**
     * Creates money from a decimal amount, rounding HALF_UP to the currency scale.
     * Use only at the edges (parsing user input, importing a file).
     */
    public static Money ofDecimal(BigDecimal amount, Currency currency) {
        Objects.requireNonNull(amount, "amount must not be null");
        return new Money(amount.setScale(currency.scale(), RoundingMode.HALF_UP)
                .movePointRight(currency.scale())
                .longValueExact(), currency);
    }

    // ------------------------------------------------------------------ arithmetic

    public Money plus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.addExact(minorUnits, other.minorUnits), currency);
    }

    public Money minus(Money other) {
        requireSameCurrency(other);
        return new Money(Math.subtractExact(minorUnits, other.minorUnits), currency);
    }

    public Money multiply(long factor) {
        return new Money(Math.multiplyExact(minorUnits, factor), currency);
    }

    /**
     * Applies a rate expressed in basis points (1 bp = 0.01%), rounding HALF_UP.
     * Used for fees and commission, e.g. {@code amount.percentage(150)} = 1.5%.
     */
    public Money percentage(long basisPoints) {
        return new Money(BigDecimal.valueOf(minorUnits)
                .multiply(BigDecimal.valueOf(basisPoints))
                .divide(BigDecimal.valueOf(10_000), 0, RoundingMode.HALF_UP)
                .longValueExact(), currency);
    }

    public Money negate() {
        return new Money(Math.negateExact(minorUnits), currency);
    }

    public Money abs() {
        return minorUnits < 0 ? negate() : this;
    }

    // ------------------------------------------------------------------ predicates

    public boolean isZero() {
        return minorUnits == 0L;
    }

    public boolean isPositive() {
        return minorUnits > 0L;
    }

    public boolean isNegative() {
        return minorUnits < 0L;
    }

    public boolean isGreaterThan(Money other) {
        return compareTo(other) > 0;
    }

    public boolean isLessThan(Money other) {
        return compareTo(other) < 0;
    }

    // ------------------------------------------------------------------ conversion

    public BigDecimal toBigDecimal() {
        return BigDecimal.valueOf(minorUnits, currency.scale());
    }

    public Currency currency() {
        return currency;
    }

    @Override
    public int compareTo(Money other) {
        requireSameCurrency(other);
        return Long.compare(minorUnits, other.minorUnits);
    }

    private void requireSameCurrency(Money other) {
        Objects.requireNonNull(other, "other money must not be null");
        if (currency != other.currency) {
            throw new CurrencyMismatchException(currency, other.currency);
        }
    }

    @Override
    public String toString() {
        return toBigDecimal().toPlainString() + " " + currency.name();
    }
}
