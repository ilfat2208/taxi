package kz.taxi.trip.api;

import kz.taxi.common.core.web.PageResponse;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.application.TripDetails;
import kz.taxi.trip.domain.FareBreakdown;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.Trip;
import kz.taxi.trip.domain.TripReceipt;
import kz.taxi.trip.domain.TripTransition;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Domain to transport mapping.
 *
 * <p>Kept apart from the controllers so "what the client sees" is one file to review,
 * and so an internal field added to an entity stops here instead of appearing in the API
 * by accident.
 *
 * <p>{@link #toReceipt(TripReceipt)} is the only place a check becomes JSON, which is
 * what makes the two ways of asking for one — the receipt endpoint and the receipt
 * embedded in a trip — return byte-identical bodies.
 */
@Component
public class TripMapper {

    private final Clock clock;

    public TripMapper(Clock clock) {
        this.clock = clock;
    }

    // ------------------------------------------------------------------ requests

    public TripDtos.QuoteResponse toResponse(Quote quote) {
        return new TripDtos.QuoteResponse(
                quote.getId(),
                quote.getTariff().name(),
                quote.getDistanceM(),
                quote.getDurationS(),
                quote.getPriceMinor(),
                quote.getCurrency().name(),
                quote.getCommissionBp(),
                quote.getCommissionMinor(),
                quote.getDriverNetMinor(),
                quote.getSurgeBp(),
                new TripDtos.BreakdownResponse(quote.getBaseMinor(), quote.getDistanceMinor(), quote.getTimeMinor()),
                quote.getExpiresAt());
    }

    /** The 202 answer of the ordering call: the id the app polls from now on. */
    public TripDtos.TripRequestedResponse toRequestedResponse(Trip trip) {
        return new TripDtos.TripRequestedResponse(
                trip.getId(),
                trip.getTripNumber(),
                trip.getStatus().name(),
                trip.getPriceMinor(),
                trip.getCurrency().name(),
                trip.getRequestedAt());
    }

    // ------------------------------------------------------------------ trip

    public TripDtos.TripResponse toResponse(TripDetails details) {
        Trip trip = details.trip();
        TripReceipt receipt = details.receiptOrNull();
        return new TripDtos.TripResponse(
                trip.getId(),
                trip.getTripNumber(),
                trip.getStatus().name(),
                trip.getRiderUserId(),
                trip.getDriverId(),
                trip.getDriverName(),
                trip.getVehiclePlate(),
                trip.getTariff().name(),
                new TripDtos.PointResponse(trip.getPickupLat(), trip.getPickupLon(), trip.getPickupAddress()),
                new TripDtos.PointResponse(trip.getDropoffLat(), trip.getDropoffLon(), trip.getDropoffAddress()),
                trip.getDistanceM(),
                trip.getDurationS(),
                trip.getPriceMinor(),
                trip.getCommissionBp(),
                trip.getCommissionMinor(),
                trip.getDriverNetMinor(),
                trip.getCurrency().name(),
                trip.getHoldId(),
                trip.getHoldStatus().name(),
                trip.getCancelReason(),
                trip.getRatingStars(),
                trip.getRatingComment(),
                trip.getRequestedAt(),
                trip.getAssignedAt(),
                trip.getArrivedAt(),
                trip.getStartedAt(),
                trip.getCompletedAt(),
                trip.getCancelledAt(),
                toTimeline(details.timeline()),
                receipt == null ? null : toReceipt(receipt));
    }

    public List<TripDtos.TimelineEntryResponse> toTimeline(List<TripTransition> timeline) {
        return timeline.stream()
                .map(transition -> new TripDtos.TimelineEntryResponse(
                        transition.getToStatus().name(),
                        transition.getOccurredAt(),
                        transition.getActor()))
                .toList();
    }

    public TripDtos.ReceiptResponse toReceipt(TripReceipt receipt) {
        FareBreakdown breakdown = receipt.breakdown();
        return new TripDtos.ReceiptResponse(
                receipt.tripId(),
                receipt.tripNumber(),
                receipt.status().name(),
                receipt.completedAt(),
                receipt.tariff().name(),
                receipt.pickupLat(),
                receipt.pickupLon(),
                receipt.pickupAddress(),
                receipt.dropoffLat(),
                receipt.dropoffLon(),
                receipt.dropoffAddress(),
                receipt.distanceM(),
                receipt.durationS(),
                new TripDtos.BreakdownResponse(breakdown.baseMinor(), breakdown.distanceMinor(),
                        breakdown.timeMinor()),
                receipt.surgeBp(),
                receipt.priceMinor(),
                receipt.commissionBp(),
                receipt.commissionMinor(),
                receipt.driverNetMinor(),
                receipt.currency().name(),
                receipt.driverId(),
                receipt.driverDisplayName(),
                receipt.holdId(),
                receipt.paymentId(),
                receipt.transactionId());
    }

    // ------------------------------------------------------------------ list

    public PageResponse<TripDtos.TripSummaryResponse> toSummaryPage(PageResponse<Trip> page) {
        return PageResponse.of(page.items(), page.page(), page.size(), page.totalElements(), this::toSummary);
    }

    /**
     * One row of the board.
     *
     * <p>{@code ageSeconds} is how long ago the ride was ordered. For a live request that
     * is the number a dispatcher watches ("this one has been waiting six minutes"); for a
     * finished one it is simply the age of the record, which is what makes the field
     * honest instead of pretending to be a waiting time.
     */
    public TripDtos.TripSummaryResponse toSummary(Trip trip) {
        Instant now = clock.instant();
        return new TripDtos.TripSummaryResponse(
                trip.getId(),
                trip.getTripNumber(),
                trip.getStatus().name(),
                trip.getRiderUserId(),
                trip.getDriverId(),
                trip.getDriverName(),
                trip.getVehiclePlate(),
                trip.getTariff().name(),
                new TripDtos.PointResponse(trip.getPickupLat(), trip.getPickupLon(), trip.getPickupAddress()),
                new TripDtos.PointResponse(trip.getDropoffLat(), trip.getDropoffLon(), trip.getDropoffAddress()),
                trip.getDistanceM(),
                trip.getDurationS(),
                trip.getPriceMinor(),
                trip.getCurrency().name(),
                Math.max(0L, Duration.between(trip.getRequestedAt(), now).toSeconds()),
                trip.getRequestedAt(),
                trip.getCompletedAt(),
                trip.getCancelledAt());
    }
}
