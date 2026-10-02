package kz.taxi.order.infrastructure.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.List;

/**
 * Wire shapes of the catalog service's internal API, as this service sees them.
 *
 * <p>These records are deliberately local copies rather than a shared library: a
 * shared DTO module turns an additive field into a lockstep release for every
 * consumer. The price of the copy is one mapper per endpoint, which is also the
 * place where the catalog's error codes are translated into this service's.
 */
public final class CatalogDtos {

    private CatalogDtos() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReserveStockRequest(String orderId, List<ReserveStockItem> items) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReserveStockItem(String productId, int quantity) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReleaseRequest(String reason) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Reservation(String orderId,
                              String status,
                              String currency,
                              long subtotalMinor,
                              Instant expiresAt,
                              List<ReservationLine> items) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ReservationLine(String productId,
                                  String merchantId,
                                  String title,
                                  int quantity,
                                  long unitPriceMinor,
                                  long lineTotalMinor,
                                  String currency) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record InternalProduct(String id,
                                  String merchantId,
                                  String title,
                                  long priceMinor,
                                  String currency,
                                  String status,
                                  int availableQuantity) {
    }

    /** The public product card; only the fields a cart snapshot needs. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record PublicProduct(String id, String title, String imageUrl) {
    }
}
