package kz.taxi.catalog.api.dto;

import kz.taxi.catalog.domain.ReservationStatus;

import java.time.Instant;

/**
 * One stock hold as support sees it.
 *
 * <p>{@code status} is what turns a stuck order into an explanation: an
 * {@code ACTIVE} hold is why the units are not on sale, an {@code EXPIRED} or
 * {@code RELEASED} one is why they are, and a {@code COMMITTED} one is why they
 * are gone.
 */
public record SupportReservationResponse(
        String id,
        String orderId,
        String productId,
        int quantity,
        ReservationStatus status,
        Instant expiresAt,
        Instant createdAt
) {
}
