package kz.taxi.catalog.domain;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;

import java.util.Arrays;
import java.util.Locale;

/**
 * Sort orders offered by the catalog search endpoint.
 *
 * <p>An enum instead of a free-form string on purpose: the value ends up in an
 * {@code ORDER BY} clause, so it must be matched against a whitelist rather than
 * concatenated from user input. Unknown values are rejected with 400 instead of
 * being silently ignored — a client that asks for {@code price_asc} and gets
 * relevance order has a bug it cannot see.
 */
public enum ProductSort {

    /** Cheapest first — the default for a price-comparison marketplace. */
    PRICE_ASC("price_asc"),
    /** Most expensive first. */
    PRICE_DESC("price_desc"),
    /** Newest offers first. */
    NEWEST("newest"),
    /** Best text match first; falls back to newest when there is no query text. */
    RELEVANCE("relevance");

    public static final ProductSort DEFAULT = RELEVANCE;

    private final String wireName;

    ProductSort(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    public static ProductSort parse(String value) {
        if (value == null || value.isBlank()) {
            return DEFAULT;
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(sort -> sort.wireName.equals(normalized) || sort.name().equalsIgnoreCase(normalized))
                .findFirst()
                .orElseThrow(() -> DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                        "unknown sort '{}', expected one of price_asc, price_desc, newest, relevance", value));
    }
}
