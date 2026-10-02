package kz.taxi.common.core.money;

import java.util.Arrays;

/**
 * Currencies supported by the platform.
 *
 * <p>Taxi products are multi-currency from day one (KZT is the home
 * currency), so every amount carries its currency. {@code scale} defines how
 * many decimal places the currency has, which determines the minor-unit factor
 * used by {@link Money}.
 */
public enum Currency {

    /** Kazakhstani tenge — home currency. */
    KZT(2, "₸"),
    /** US dollar. */
    USD(2, "$"),
    /** Euro. */
    EUR(2, "€"),
    /** Russian ruble. */
    RUB(2, "₽");

    private final int scale;
    private final String symbol;

    Currency(int scale, String symbol) {
        this.scale = scale;
        this.symbol = symbol;
    }

    public int scale() {
        return scale;
    }

    /** Number of minor units in one major unit, e.g. 100 for KZT. */
    public long minorFactor() {
        return (long) Math.pow(10, scale);
    }

    public String symbol() {
        return symbol;
    }

    public static Currency of(String code) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("currency code must not be blank");
        }
        String normalized = code.trim().toUpperCase();
        return Arrays.stream(values())
                .filter(c -> c.name().equals(normalized))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unsupported currency: " + code));
    }

    public static boolean isSupported(String code) {
        if (code == null || code.isBlank()) {
            return false;
        }
        String normalized = code.trim().toUpperCase();
        return Arrays.stream(values()).anyMatch(c -> c.name().equals(normalized));
    }
}
