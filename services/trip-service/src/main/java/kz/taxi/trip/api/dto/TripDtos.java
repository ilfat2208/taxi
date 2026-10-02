package kz.taxi.trip.api.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * Request and response bodies of the trip API.
 *
 * <p>Records with validation annotations, and no domain type leaking into the transport
 * layer except the two things a client actually chooses from (a tariff and a status,
 * both as strings).
 *
 * <p>Money is always in minor units and carries its currency next to it, like every
 * other amount on the platform: a client that formats money needs the scale, and a
 * client that does arithmetic on it must never see a decimal.
 */
public final class TripDtos {

    private TripDtos() {
    }

    // ------------------------------------------------------------------ requests

    /**
     * A point on the map.
     *
     * <p>{@code address} is what the rider typed or what reverse geocoding produced.
     * It is stored and echoed back because it is what a person recognises: a dispatcher
     * reading coordinates has to open a map, while "Абая 150" he can act on.
     */
    public record PointRequest(
            @NotNull Double lat,
            @NotNull Double lon,
            @Size(max = 256) String address) {
    }

    /** Asks what a ride would cost. */
    public record QuoteRequest(
            @NotNull @Valid PointRequest pickup,
            @NotNull @Valid PointRequest dropoff,
            @NotBlank String tariff) {
    }

    /**
     * Orders the ride priced by a quote.
     *
     * <p>No coordinates and no price here on purpose: the quote already carries both,
     * and re-sending them would create a second, disagreeing version of the same
     * request. The body is small because everything that matters was agreed a moment
     * earlier.
     */
    public record CreateTripRequest(
            @NotBlank String quoteId,
            @Size(max = 512) String comment) {
    }

    /**
     * Calls the ride off.
     *
     * <p>{@code reason} is optional for the rider and mandatory for a dispatcher or
     * operator (enforced in the application layer, where the caller is known).
     * {@code cancelledBy} is only meaningful for an operator and says whose side the
     * cancellation came from — the dispatcher's console closing a ride because the
     * driver never showed up is not the same fact as the rider changing his mind.
     */
    public record CancelTripRequest(
            @Size(max = 512) String reason,
            String cancelledBy) {
    }

    /** Rates a completed ride. */
    public record RateTripRequest(
            @NotNull @Min(1) @Max(5) Integer stars,
            @Size(max = 512) String comment) {
    }

    /**
     * Puts a driver on a live request by hand.
     *
     * <p>The name and the plate are optional because the dispatcher's console already
     * knows them; when they are absent the ride stores the id and the fleet projection
     * supplies the rest to the screen.
     */
    public record AssignDriverRequest(
            @NotBlank String driverId,
            @Size(max = 128) String driverName,
            @Size(max = 16) String vehiclePlate) {
    }

    // ------------------------------------------------------------------ responses

    public record PointResponse(double lat, double lon, String address) {
    }

    /** The three parts of a price; they always add up to {@code priceMinor}. */
    public record BreakdownResponse(long baseMinor, long distanceMinor, long timeMinor) {
    }

    public record QuoteResponse(String quoteId,
                                String tariff,
                                int distanceM,
                                int durationS,
                                long priceMinor,
                                String currency,
                                int commissionBp,
                                long commissionMinor,
                                long driverNetMinor,
                                int surgeBp,
                                BreakdownResponse breakdown,
                                Instant expiresAt) {
    }

    /** What the ordering call answers: the id the rider's app will poll from now on. */
    public record TripRequestedResponse(String tripId,
                                        String tripNumber,
                                        String status,
                                        long priceMinor,
                                        String currency,
                                        Instant requestedAt) {
    }

    public record TimelineEntryResponse(String status, Instant at, String actor) {
    }

    /**
     * The check of a performed ride.
     *
     * <p>{@code paymentId} is always {@code null} in Ф2: a wallet ride is charged
     * through the account service, and {@code transactionId} is the ledger movement
     * behind it. The field is in the contract because a card or corporate ride will be
     * settled through payment-service, and the receipt is the document that must name
     * it.
     */
    public record ReceiptResponse(String tripId,
                                  String tripNumber,
                                  String status,
                                  Instant completedAt,
                                  String tariff,
                                  double pickupLat,
                                  double pickupLon,
                                  String pickupAddress,
                                  double dropoffLat,
                                  double dropoffLon,
                                  String dropoffAddress,
                                  int distanceM,
                                  int durationS,
                                  BreakdownResponse breakdown,
                                  int surgeBp,
                                  long priceMinor,
                                  int commissionBp,
                                  long commissionMinor,
                                  long driverNetMinor,
                                  String currency,
                                  String driverId,
                                  String driverDisplayName,
                                  String holdId,
                                  String paymentId,
                                  String transactionId) {
    }

    /**
     * One trip in full.
     *
     * <p>{@code receipt} is filled in for a completed ride, by the same code that serves
     * {@code GET /trips/{id}/receipt} — the rider's app shows the check on the ride
     * screen without a second call, and both answers are the same object.
     */
    public record TripResponse(String tripId,
                               String tripNumber,
                               String status,
                               String riderUserId,
                               String driverId,
                               String driverName,
                               String vehiclePlate,
                               String tariff,
                               PointResponse pickup,
                               PointResponse dropoff,
                               int distanceM,
                               int durationS,
                               long priceMinor,
                               int commissionBp,
                               long commissionMinor,
                               long driverNetMinor,
                               String currency,
                               String holdId,
                               String holdStatus,
                               String cancelReason,
                               Integer ratingStars,
                               String ratingComment,
                               Instant requestedAt,
                               Instant assignedAt,
                               Instant arrivedAt,
                               Instant startedAt,
                               Instant completedAt,
                               Instant cancelledAt,
                               List<TimelineEntryResponse> timeline,
                               ReceiptResponse receipt) {
    }

    /**
     * One trip as a list shows it.
     *
     * <p>Carries what a dispatcher needs to decide whether to act: where the rider is,
     * what the ride costs, who is on it, and how long the request has been waiting. It
     * deliberately does not carry the timeline or the receipt — a list of them would be
     * a page of documents where a page of rows is needed.
     */
    public record TripSummaryResponse(String tripId,
                                      String tripNumber,
                                      String status,
                                      String riderUserId,
                                      String driverId,
                                      String driverName,
                                      String vehiclePlate,
                                      String tariff,
                                      PointResponse pickup,
                                      PointResponse dropoff,
                                      int distanceM,
                                      int durationS,
                                      long priceMinor,
                                      String currency,
                                      long ageSeconds,
                                      Instant requestedAt,
                                      Instant completedAt,
                                      Instant cancelledAt) {
    }
}
