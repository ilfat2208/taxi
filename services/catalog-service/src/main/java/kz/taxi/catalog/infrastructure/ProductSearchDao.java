package kz.taxi.catalog.infrastructure;

import kz.taxi.catalog.domain.ProductSort;
import kz.taxi.catalog.domain.ProductStatus;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;

/**
 * Full-text product search, in SQL.
 *
 * <p>Search runs against the generated {@code product.search_vector} column with
 * {@code websearch_to_tsquery}, not against {@code LIKE '%term%'}:
 *
 * <ul>
 *   <li>{@code websearch_to_tsquery} understands what users actually type —
 *       quoted phrases, {@code OR}, a leading minus to exclude — and never throws
 *       on malformed input (unlike {@code to_tsquery}), so a stray quote cannot
 *       turn a search into a 500;</li>
 *   <li>the GIN index {@code idx_product_search} serves the {@code @@} operator,
 *       which a {@code LIKE} could not use;</li>
 *   <li>{@code ts_rank} gives relevance, so the default ordering of a text search
 *       is "best match first" instead of "whatever the planner returned".</li>
 * </ul>
 *
 * <p>The {@code 'simple'} configuration is deliberate: the vector column is
 * generated with it, and it is also the only sane choice for a catalog mixing
 * Russian and Kazakh titles, where a language-specific stemmer would mangle one of
 * the two. The price of that choice is no stemming — acceptable until stage 2
 * (a dedicated search index), which is why this class is the only place that knows
 * how search works.
 *
 * <p>A separate {@code count(*)} query with the same WHERE clause produces the
 * total: counting the fetched page in memory would silently break pagination as
 * soon as the catalog outgrows one page.
 *
 * <p>Table names are qualified with the {@code catalog} schema explicitly. JPA gets
 * that schema from {@code hibernate.default_schema}, but native SQL through
 * {@link NamedParameterJdbcTemplate} runs on a connection whose {@code search_path}
 * is {@code "$user", public} — unqualified names would resolve against {@code public}
 * and fail. The schema of this service is fixed by its own Flyway configuration, so
 * spelling it out is more honest than relying on connection state.
 */
@Repository
public class ProductSearchDao {

    private static final String SEARCH_SELECT = """
            select p.id                  as id,
                   p.merchant_id         as merchant_id,
                   m.name                as merchant_name,
                   m.display_name        as merchant_display_name,
                   p.title               as title,
                   p.description         as description,
                   p.category            as category,
                   p.brand               as brand,
                   p.price_minor         as price_minor,
                   p.currency            as currency,
                   p.image_url           as image_url,
                   p.status              as status,
                   coalesce(s.on_hand, 0) - coalesce(s.reserved, 0) as available_quantity
            from catalog.product p
            join catalog.merchant m on m.id = p.merchant_id
            left join catalog.stock s on s.product_id = p.id
            """;

    private static final String COUNT_SELECT = "select count(*) from catalog.product p";

    private static final RowMapper<ProductSearchRow> ROW_MAPPER = (rs, rowNum) -> new ProductSearchRow(
            rs.getString("id"),
            rs.getString("merchant_id"),
            publicMerchantName(rs.getString("merchant_display_name"), rs.getString("merchant_name")),
            rs.getString("title"),
            rs.getString("description"),
            rs.getString("category"),
            rs.getString("brand"),
            rs.getLong("price_minor"),
            rs.getString("currency"),
            rs.getString("image_url"),
            rs.getString("status"),
            rs.getInt("available_quantity"));

    private final NamedParameterJdbcTemplate jdbc;

    public ProductSearchDao(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public ProductSearchPage search(ProductSearchCriteria criteria, ProductSort sort, int page, int size) {
        MapSqlParameterSource filterParameters = new MapSqlParameterSource();
        List<String> conditions = new ArrayList<>();
        applyConditions(criteria, conditions, filterParameters);
        String where = " where " + String.join(" and ", conditions);

        boolean ranked = criteria.hasQuery() && sort == ProductSort.RELEVANCE;
        String sql = SEARCH_SELECT + where + " order by " + orderBy(sort, ranked) + " limit :limit offset :offset";
        MapSqlParameterSource pageParameters = new MapSqlParameterSource()
                .addValues(filterParameters.getValues())
                .addValue("limit", size)
                .addValue("offset", (long) page * size);

        List<ProductSearchRow> rows = jdbc.query(sql, pageParameters, ROW_MAPPER);
        Long total = jdbc.queryForObject(COUNT_SELECT + where, filterParameters, Long.class);
        return new ProductSearchPage(rows, total == null ? rows.size() : total);
    }

    private static void applyConditions(ProductSearchCriteria criteria,
                                        List<String> conditions,
                                        MapSqlParameterSource parameters) {
        // Archived offers are invisible to shoppers and must not be ordered;
        // the other statuses stay listed so a shopper can see that an offer exists.
        conditions.add("p.status <> '" + ProductStatus.ARCHIVED.name() + "'");
        if (criteria.hasQuery()) {
            conditions.add("p.search_vector @@ websearch_to_tsquery('simple', :query)");
            parameters.addValue("query", criteria.query());
        }
        if (criteria.hasCategory()) {
            conditions.add("lower(p.category) = lower(:category)");
            parameters.addValue("category", criteria.category());
        }
        if (criteria.hasMerchantId()) {
            conditions.add("p.merchant_id = :merchantId");
            parameters.addValue("merchantId", criteria.merchantId());
        }
        if (criteria.minPriceMinor() != null) {
            conditions.add("p.price_minor >= :minPriceMinor");
            parameters.addValue("minPriceMinor", criteria.minPriceMinor());
        }
        if (criteria.maxPriceMinor() != null) {
            conditions.add("p.price_minor <= :maxPriceMinor");
            parameters.addValue("maxPriceMinor", criteria.maxPriceMinor());
        }
    }

    /**
     * Whitelisted ORDER BY fragments.
     *
     * <p>{@code sort} reaches SQL only through this switch: an enum cannot carry
     * an injection payload, and an unknown value was already rejected with 400 in
     * {@link ProductSort#parse}.
     */
    private static String orderBy(ProductSort sort, boolean ranked) {
        // The id tie-breaker keeps paging stable: without it two products of the
        // same price could swap places between page 1 and page 2.
        return switch (sort) {
            case PRICE_ASC -> "p.price_minor asc, p.id asc";
            case PRICE_DESC -> "p.price_minor desc, p.id desc";
            case NEWEST -> "p.created_at desc, p.id desc";
            case RELEVANCE -> ranked
                    ? "ts_rank(p.search_vector, websearch_to_tsquery('simple', :query)) desc, p.created_at desc, p.id desc"
                    : "p.created_at desc, p.id desc";
        };
    }

    private static String publicMerchantName(String displayName, String name) {
        return displayName == null || displayName.isBlank() ? name : displayName;
    }
}
