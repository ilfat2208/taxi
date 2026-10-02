package kz.taxi.catalog.infrastructure;

/**
 * One row of the native search query.
 *
 * <p>A flat projection instead of an entity graph: the catalog page needs the
 * merchant name and the availability number, which live in two other tables, and
 * a search hit never modifies anything. Reading exactly the twelve columns the
 * response shows also keeps the query cheap on a table with a GIN index.
 */
public record ProductSearchRow(
        String id,
        String merchantId,
        String merchantName,
        String title,
        String description,
        String category,
        String brand,
        long priceMinor,
        String currency,
        String imageUrl,
        String status,
        int availableQuantity
) {
}
