package kz.taxi.catalog.infrastructure;

import java.util.List;

/** A search page: the requested slice plus the total that {@code PageResponse} needs. */
public record ProductSearchPage(List<ProductSearchRow> rows, long totalElements) {
}
