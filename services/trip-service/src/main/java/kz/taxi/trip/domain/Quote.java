package kz.taxi.trip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Duration;
import java.time.Instant;

/**
 * A price the platform promised, held for a short while.
 *
 * <p>A quote exists because the promise has to be checkable. The rider sees
 * {"priceMinor": 1 250} on his screen and orders a car thirty seconds later; between
 * those two moments the driver search runs and money is reserved. Without a stored
 * quote the second request would have to re-price the ride, and any change in the
 * tariff or the route estimate would silently charge a different amount than the one
 * the rider agreed to.
 *
 * <p>The {@code expiresAt} is part of the contract, not a cache detail: a price held
 * for an hour is a price a rider can shop around with while the fuel price moves, so
 * the TTL is short (configuration, {@code taxi.trip.quote-ttl}) and an expired quote
 * is refused with {@link TripErrorCode#QUOTE_EXPIRED} rather than quietly re-priced.
 *
 * <p>{@code consumedAt} makes a quote single-use: ordering two cars from one promise
 * would take two holds for one agreed price and leave the first driver unpaid.
 */
@Entity
@Table(name = "quote")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Quote {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "rider_user_id", length = 64, nullable = false, updatable = false)
    private String riderUserId;

    /**
     * The wallet the fare is anchored to.
     *
     * <p>Resolved while the quote is created — that is the moment the platform knows
     * the rider's phone, and the last moment before anything is promised. Carrying the
     * account id through the quote is what lets the fare be reserved later from a
     * dispatcher's assign call, where the rider's token (and therefore his phone) is
     * not present at all.
     */
    @Column(name = "rider_account_id", length = 26, nullable = false, updatable = false)
    private String riderAccountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "tariff", length = 16, nullable = false, updatable = false)
    private Tariff tariff;

    @Column(name = "pickup_lat", nullable = false, updatable = false)
    private double pickupLat;

    @Column(name = "pickup_lon", nullable = false, updatable = false)
    private double pickupLon;

    @Column(name = "pickup_address", length = 256)
    private String pickupAddress;

    @Column(name = "dropoff_lat", nullable = false, updatable = false)
    private double dropoffLat;

    @Column(name = "dropoff_lon", nullable = false, updatable = false)
    private double dropoffLon;

    @Column(name = "dropoff_address", length = 256)
    private String dropoffAddress;

    @Column(name = "distance_m", nullable = false, updatable = false)
    private int distanceM;

    @Column(name = "duration_s", nullable = false, updatable = false)
    private int durationS;

    @Column(name = "price_minor", nullable = false, updatable = false)
    private long priceMinor;

    @Column(name = "commission_minor", nullable = false, updatable = false)
    private long commissionMinor;

    @Column(name = "driver_net_minor", nullable = false, updatable = false)
    private long driverNetMinor;

    @Column(name = "base_minor", nullable = false, updatable = false)
    private long baseMinor;

    @Column(name = "distance_minor", nullable = false, updatable = false)
    private long distanceMinor;

    @Column(name = "time_minor", nullable = false, updatable = false)
    private long timeMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "surge_bp", nullable = false, updatable = false)
    private int surgeBp;

    @Column(name = "commission_bp", nullable = false, updatable = false)
    private int commissionBp;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "consumed_trip_id", length = 26)
    private String consumedTripId;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    // ------------------------------------------------------------------ factories

    /** Records a price promise for one rider, valid for {@code ttl}. */
    public static Quote issue(String riderUserId,
                              String riderAccountId,
                              Tariff tariff,
                              double pickupLat,
                              double pickupLon,
                              String pickupAddress,
                              double dropoffLat,
                              double dropoffLon,
                              String dropoffAddress,
                              Currency currency,
                              FareQuote fare,
                              Instant now,
                              Duration ttl) {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("quote TTL must be positive");
        }
        if (riderAccountId == null || riderAccountId.isBlank()) {
            throw DomainException.of(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND,
                    "a quote needs the wallet it will be paid from");
        }
        Quote quote = new Quote();
        quote.id = Ulid.nextId();
        quote.riderUserId = riderUserId;
        quote.riderAccountId = riderAccountId;
        quote.tariff = tariff;
        quote.pickupLat = pickupLat;
        quote.pickupLon = pickupLon;
        quote.pickupAddress = pickupAddress;
        quote.dropoffLat = dropoffLat;
        quote.dropoffLon = dropoffLon;
        quote.dropoffAddress = dropoffAddress;
        quote.distanceM = fare.route().distanceM();
        quote.durationS = fare.route().durationS();
        quote.priceMinor = fare.priceMinor();
        quote.commissionMinor = fare.commissionMinor();
        quote.driverNetMinor = fare.driverNetMinor();
        quote.baseMinor = fare.breakdown().baseMinor();
        quote.distanceMinor = fare.breakdown().distanceMinor();
        quote.timeMinor = fare.breakdown().timeMinor();
        quote.currency = currency;
        quote.surgeBp = fare.surgeBp();
        quote.commissionBp = fare.commissionBp();
        quote.createdAt = now;
        quote.expiresAt = now.plus(ttl);
        return quote;
    }

    // ------------------------------------------------------------------ lifecycle

    /** Marks the quote as spent on a trip. Called once, when the trip is created. */
    public void consume(String tripId, Instant now) {
        if (consumedAt != null) {
            throw DomainException.of(TripErrorCode.QUOTE_ALREADY_USED,
                            "quote {} was already used for trip {}", id, consumedTripId)
                    .withDetail("quoteId", id)
                    .withDetail("tripId", consumedTripId);
        }
        this.consumedAt = now;
        this.consumedTripId = tripId;
    }

    /** True when the price promise has run out. */
    public boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    public boolean isConsumed() {
        return consumedAt != null;
    }

    /**
     * The quote, if it may still be ordered with.
     *
     * <p>Separated from the getters so every caller gets the same refusal: an expired
     * quote and a spent quote are different answers to the rider ("ask for a new
     * price" versus "you already ordered this ride"), and neither of them may be
     * silently accepted.
     */
    public Quote requireUsable(Instant now) {
        if (consumedAt != null) {
            throw DomainException.of(TripErrorCode.QUOTE_ALREADY_USED,
                            "quote {} was already used for trip {}", id, consumedTripId)
                    .withDetail("quoteId", id)
                    .withDetail("tripId", consumedTripId);
        }
        if (isExpired(now)) {
            throw DomainException.of(TripErrorCode.QUOTE_EXPIRED,
                            "quote {} expired at {}", id, expiresAt)
                    .withDetail("quoteId", id)
                    .withDetail("expiresAt", expiresAt.toString());
        }
        return this;
    }
}
