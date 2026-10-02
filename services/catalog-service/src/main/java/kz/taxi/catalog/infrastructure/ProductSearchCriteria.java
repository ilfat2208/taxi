package kz.taxi.catalog.infrastructure;

/**
 * Filters of the public product search.
 *
 * <p>Blank strings are normalized to {@code null} so that "no filter" has a
 * single representation — otherwise {@code ?category=} and a missing parameter
 * would produce different SQL for the same user intent.
 */
public record ProductSearchCriteria(
        String query,
        String category,
        String merchantId,
        Long minPriceMinor,
        Long maxPriceMinor
) {

    public ProductSearchCriteria {
        query = blankToNull(query);
        category = blankToNull(category);
        merchantId = blankToNull(merchantId);
    }

    public static ProductSearchCriteria of(String query, String category, String merchantId,
                                           Long minPriceMinor, Long maxPriceMinor) {
        return new ProductSearchCriteria(query, category, merchantId, minPriceMinor, maxPriceMinor);
    }

    public boolean hasQuery() {
        return query != null;
    }

    public boolean hasCategory() {
        return category != null;
    }

    public boolean hasMerchantId() {
        return merchantId != null;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
