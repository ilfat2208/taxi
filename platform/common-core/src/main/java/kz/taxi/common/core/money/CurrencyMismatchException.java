package kz.taxi.common.core.money;

/** Thrown when an operation mixes two different currencies. */
public class CurrencyMismatchException extends IllegalArgumentException {

    private final Currency expected;
    private final Currency actual;

    public CurrencyMismatchException(Currency expected, Currency actual) {
        super("currency mismatch: expected %s but got %s".formatted(expected, actual));
        this.expected = expected;
        this.actual = actual;
    }

    public Currency expected() {
        return expected;
    }

    public Currency actual() {
        return actual;
    }
}
