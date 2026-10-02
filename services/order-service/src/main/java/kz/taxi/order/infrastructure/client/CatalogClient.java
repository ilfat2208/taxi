package kz.taxi.order.infrastructure.client;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.order.domain.OrderErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The catalog service, as the checkout saga needs it.
 *
 * <p>The catalog owns stock; the order service only asks. Two rules shape this
 * client:
 *
 * <ul>
 *   <li><b>A business refusal is not an infrastructure failure.</b>
 *       {@code INSUFFICIENT_STOCK}, {@code PRODUCT_NOT_AVAILABLE},
 *       {@code PRODUCT_NOT_FOUND}, {@code MIXED_CURRENCIES} and
 *       {@code INVALID_QUANTITY} arrive as {@link OrderErrorCode#PRODUCT_UNAVAILABLE},
 *       which the saga turns into a cancelled order with a reason a customer can
 *       read. Anything else the catalog answers becomes
 *       {@link OrderErrorCode#CATALOG_ERROR} and leaves the order alone — an
 *       unknown code must never be read as "the goods are not there", because that
 *       would release stock we may already hold.</li>
 *   <li><b>The reservation is keyed by the order id</b>, so every call here is safe
 *       to repeat: the same order asking twice gets the same hold, a commit or a
 *       release of a reservation that does not exist is a no-op
 *       ({@code 404 RESERVATION_NOT_FOUND}). This is what makes a retried saga step
 *       — after a timeout, a redeploy or a recovery job pass — harmless.</li>
 * </ul>
 *
 * <p>Error codes are matched by their string values on purpose: the two services
 * deploy independently, and a shared enum would couple their release cycles.
 */
@Slf4j
public class CatalogClient {

    /**
     * The product status a cart may snapshot.
     *
     * <p>This is the catalog's own vocabulary, and it is constrained there by
     * {@code CHECK (status IN ('DRAFT','ACTIVE','OUT_OF_STOCK','ARCHIVED'))}: a
     * product is sellable exactly when it is {@code ACTIVE}. Keeping the string here
     * rather than importing an enum keeps the two services deployable
     * independently — but the value must match the catalog's contract, otherwise
     * every product looks unavailable.
     */
    public static final String STATUS_SELLABLE = "ACTIVE";

    /** True when the catalog considers this product buyable. */
    public static boolean isSellable(String status) {
        return status != null && STATUS_SELLABLE.equalsIgnoreCase(status.trim());
    }

    /**
     * Catalog codes that mean "this cannot be bought right now".
     *
     * <p>Only these cancel an order. A code we do not recognise is an incident, not
     * a refusal, so it leaves the order pending instead of releasing stock.
     */
    private static final Set<String> REJECTION_CODES = Set.of(
            "INSUFFICIENT_STOCK",
            "PRODUCT_NOT_AVAILABLE",
            "PRODUCT_NOT_FOUND",
            "MIXED_CURRENCIES",
            "INVALID_QUANTITY");

    private final RestClient client;
    private final DownstreamErrors errors;

    public CatalogClient(RestClient client, DownstreamErrors errors) {
        this.client = client;
        this.errors = errors;
    }

    /**
     * Prices and validates one product for a cart line.
     *
     * <p>The internal view is used rather than the public card because it carries
     * the sellable status and the remaining quantity — a cart must not accept a
     * product that cannot be bought.
     */
    public CatalogDtos.InternalProduct getProduct(String productId) {
        try {
            CatalogDtos.InternalProduct product = client.get()
                    .uri("/api/v1/catalog/internal/products/{id}", productId)
                    .retrieve()
                    .body(CatalogDtos.InternalProduct.class);
            if (product == null) {
                throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                        "the catalog returned an empty product for {}", productId);
            }
            return product;
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            // A product the catalog does not know cannot be sold: from the
            // customer's point of view that is an unavailable product, not a
            // broken catalog.
            if (problem.httpStatus() >= 400 && problem.httpStatus() < 500) {
                throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                                "product {} cannot be added: {}", productId, problem.summary())
                        .withDetail("productId", productId)
                        .withDetail("downstreamCode", problem.code());
            }
            throw errors.answeredWithError(OrderErrorCode.CATALOG_ERROR, "catalog", "price the product", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("catalog", "price the product", unavailable);
        }
    }

    /**
     * The product image, best effort.
     *
     * <p>It only exists on the public product card, and it is decoration: a catalog
     * hiccup must not stop a customer from putting something in their cart, so the
     * failure is swallowed and the snapshot simply has no image.
     */
    public String imageUrlOf(String productId) {
        try {
            CatalogDtos.PublicProduct product = client.get()
                    .uri("/api/v1/catalog/products/{id}", productId)
                    .retrieve()
                    .body(CatalogDtos.PublicProduct.class);
            return product == null ? null : product.imageUrl();
        } catch (RuntimeException failure) {
            log.debug("no image for product {}: {}", productId, failure.toString());
            return null;
        }
    }

    /**
     * Holds stock for an order.
     *
     * @throws DomainException {@code PRODUCT_UNAVAILABLE} when the catalog refuses
     *                         for a business reason (the saga cancels the order),
     *                         {@code CATALOG_ERROR}/{@code DOWNSTREAM_UNAVAILABLE}
     *                         when the outcome is not knowable (the saga leaves the
     *                         order pending and the recovery job resolves it)
     */
    public CatalogDtos.Reservation reserve(String orderId, List<CatalogDtos.ReserveStockItem> items) {
        try {
            CatalogDtos.Reservation reservation = client.post()
                    .uri("/api/v1/catalog/internal/stock/reservations")
                    .body(new CatalogDtos.ReserveStockRequest(orderId, items))
                    .retrieve()
                    .body(CatalogDtos.Reservation.class);
            if (reservation == null) {
                throw DomainException.of(OrderErrorCode.CATALOG_ERROR,
                        "the catalog accepted the reservation of {} but answered with an empty body", orderId);
            }
            return reservation;
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (REJECTION_CODES.contains(problem.code())) {
                throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                                "the catalog refused to reserve stock: {}", problem.summary())
                        .withDetail("orderId", orderId)
                        .withDetail("downstreamCode", problem.code());
            }
            throw errors.answeredWithError(OrderErrorCode.CATALOG_ERROR, "catalog", "reserve stock", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("catalog", "reserve stock", unavailable);
        }
    }

    /**
     * Turns a hold into a sale. Called after the money is captured.
     *
     * <p>A missing reservation is not an error: either the recovery job already
     * committed it, or the hold expired and the goods went back on sale — in both
     * cases there is nothing to commit and the order must not be disturbed.
     */
    public void commit(String orderId) {
        try {
            client.post()
                    .uri("/api/v1/catalog/internal/stock/reservations/{orderId}/commit", orderId)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (isMissingReservation(problem)) {
                log.warn("no active stock reservation to commit for order {} ({})", orderId, problem.summary());
                return;
            }
            throw errors.answeredWithError(OrderErrorCode.CATALOG_ERROR, "catalog", "commit stock", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("catalog", "commit stock", unavailable);
        }
    }

    /**
     * Puts the goods back on sale. Called on every cancellation.
     *
     * <p>Idempotent by construction: releasing an order that never held stock (or
     * was already released) is a no-op, which is what lets the recovery job retry a
     * compensation without fear.
     */
    public void release(String orderId, String reason) {
        try {
            client.post()
                    .uri("/api/v1/catalog/internal/stock/reservations/{orderId}/release", orderId)
                    .body(new CatalogDtos.ReleaseRequest(reason))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (isMissingReservation(problem)) {
                log.debug("nothing to release for order {} ({})", orderId, problem.summary());
                return;
            }
            throw errors.answeredWithError(OrderErrorCode.CATALOG_ERROR, "catalog", "release stock", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("catalog", "release stock", unavailable);
        }
    }

    /** The stored hold of an order; empty when the order never reserved anything. */
    public Optional<CatalogDtos.Reservation> findReservation(String orderId) {
        try {
            return Optional.ofNullable(client.get()
                    .uri("/api/v1/catalog/internal/stock/reservations/{orderId}", orderId)
                    .retrieve()
                    .body(CatalogDtos.Reservation.class));
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (problem.httpStatus() == 404) {
                return Optional.empty();
            }
            throw errors.answeredWithError(OrderErrorCode.CATALOG_ERROR, "catalog", "read the reservation", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("catalog", "read the reservation", unavailable);
        }
    }

    private static boolean isMissingReservation(DownstreamErrors.Problem problem) {
        return problem.httpStatus() == 404 || "RESERVATION_NOT_FOUND".equals(problem.code());
    }
}
