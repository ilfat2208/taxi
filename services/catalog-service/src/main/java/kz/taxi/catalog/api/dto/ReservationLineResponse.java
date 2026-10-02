package kz.taxi.catalog.api.dto;

/**
 * One held line of a reservation.
 *
 * <p>{@code unitPriceMinor} is the price the catalog holds for the product: the
 * frozen schema has no price snapshot column on {@code stock_reservation}, so the
 * order service must persist the amount it was quoted here.
 */
public record ReservationLineResponse(
        String productId,
        String merchantId,
        String title,
        int quantity,
        long unitPriceMinor,
        long lineTotalMinor,
        String currency
) {
}
