package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ReservationStatus;

import java.time.Instant;
import java.util.List;

/**
 * The state of one order's stock hold, as stored.
 *
 * <p>Returned by reserve, commit, release and get, always rebuilt from the rows in
 * the database. That is what makes the internal API idempotent: a repeated call
 * answers with the stored state instead of recomputing a new one.
 *
 * @param status     ACTIVE while goods are held, then COMMITTED/RELEASED/EXPIRED
 * @param expiresAt  when the expiry job may take the stock back (null = never)
 * @param subtotalMinor sum of {@code unitPriceMinor * quantity} of all lines
 */
public record ReservationResponse(
        String orderId,
        ReservationStatus status,
        String currency,
        long subtotalMinor,
        Instant expiresAt,
        List<ReservationLineResponse> items
) {
}
