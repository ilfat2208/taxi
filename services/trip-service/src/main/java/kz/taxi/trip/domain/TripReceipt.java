package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;

import java.time.Instant;

/**
 * The check of a performed ride: what was agreed, what was driven, what was charged.
 *
 * <p>A receipt exists for two reasons. The rider's screen shows it after every ride,
 * and support needs one document that answers "why is this amount on my statement"
 * without reading the tariff table of the day or the trip's transition history. Both
 * callers read the same object, built from the trip itself, so a receipt served from
 * {@code GET /trips/{id}/receipt} and the one embedded in {@code GET /trips/{id}} can
 * never disagree.
 *
 * <p>Two invariants are checked in the constructor rather than trusted:
 *
 * <pre>
 *   baseMinor + distanceMinor + timeMinor = priceMinor
 *   driverNetMinor + commissionMinor      = priceMinor
 * </pre>
 *
 * <p>They hold by construction ({@link FareCalculator} derives the driver's share by
 * subtraction and folds the minimum fare into the base component) and are additionally
 * enforced by database CHECK constraints on {@code trip}. Checking them here as well
 * costs nothing, and turns "a refactor broke the arithmetic" into a loud failure at
 * the boundary instead of a receipt with a hole in it that a person has to notice.
 *
 * <p>{@code paymentId} is deliberately part of the shape and always {@code null} in
 * Ф2: a wallet ride is charged through the account service (hold, then capture), and
 * there is no payment-service payment behind it. When card and corporate payments
 * arrive, the ride is settled through a payment and this is where its id goes. The
 * real ledger reference today is {@code transactionId}, the capture's transaction in
 * {@code account.ledger_entry}.
 *
 * @param commissionBp the rate that was applied, not the rate configured today
 */
public record TripReceipt(String tripId,
                          String tripNumber,
                          TripStatus status,
                          Instant completedAt,
                          Tariff tariff,
                          double pickupLat,
                          double pickupLon,
                          String pickupAddress,
                          double dropoffLat,
                          double dropoffLon,
                          String dropoffAddress,
                          int distanceM,
                          int durationS,
                          FareBreakdown breakdown,
                          int surgeBp,
                          long priceMinor,
                          int commissionBp,
                          long commissionMinor,
                          long driverNetMinor,
                          Currency currency,
                          String driverId,
                          String driverDisplayName,
                          String holdId,
                          String paymentId,
                          String transactionId) {

    public TripReceipt {
        if (breakdown == null) {
            throw new IllegalStateException("a receipt without a fare breakdown is not a receipt");
        }
        long components = breakdown.totalMinor();
        if (components != priceMinor) {
            throw new IllegalStateException(
                    "receipt components %d do not add up to price %d (trip %s)"
                            .formatted(components, priceMinor, tripId));
        }
        long split = driverNetMinor + commissionMinor;
        if (split != priceMinor) {
            throw new IllegalStateException(
                    "receipt split %d (driver %d + commission %d) does not equal price %d (trip %s)"
                            .formatted(split, driverNetMinor, commissionMinor, priceMinor, tripId));
        }
    }

    /**
     * Builds the receipt of a performed trip.
     *
     * <p>Refuses anything that is not {@code COMPLETED}: a receipt is the record of a
     * ride that happened, and issuing one for a trip that is still moving would be a
     * promise with the authority of a document.
     */
    public static TripReceipt of(Trip trip) {
        if (trip.getStatus() != TripStatus.COMPLETED) {
            throw DomainException.of(TripErrorCode.TRIP_NOT_COMPLETED,
                            "trip {} is {} — a receipt exists only for a completed trip",
                            trip.getId(), trip.getStatus())
                    .withDetail("tripId", trip.getId())
                    .withDetail("status", trip.getStatus().name());
        }
        return new TripReceipt(
                trip.getId(),
                trip.getTripNumber(),
                trip.getStatus(),
                trip.getCompletedAt(),
                trip.getTariff(),
                trip.getPickupLat(),
                trip.getPickupLon(),
                trip.getPickupAddress(),
                trip.getDropoffLat(),
                trip.getDropoffLon(),
                trip.getDropoffAddress(),
                trip.getDistanceM(),
                trip.getDurationS(),
                new FareBreakdown(trip.getBaseMinor(), trip.getDistanceMinor(), trip.getTimeMinor()),
                trip.getSurgeBp(),
                trip.getPriceMinor(),
                trip.getCommissionBp(),
                trip.getCommissionMinor(),
                trip.getDriverNetMinor(),
                trip.getCurrency(),
                trip.getDriverId(),
                trip.getDriverName(),
                trip.getHoldId(),
                null,
                trip.getCaptureTransactionId());
    }
}
