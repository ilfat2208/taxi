package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.domain.FareCalculator;
import kz.taxi.trip.domain.FareQuote;
import kz.taxi.trip.domain.GeoMath;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.RouteEstimate;
import kz.taxi.trip.domain.RouteEstimator;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.infrastructure.QuoteRepository;
import kz.taxi.trip.infrastructure.TripProperties;
import kz.taxi.trip.infrastructure.client.RideAccountClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

/**
 * Prices a ride and remembers the promise.
 *
 * <p>Three things happen here that are worth separating from each other:
 *
 * <ol>
 *   <li><b>Validation.</b> Coordinates that cannot exist on Earth are refused before
 *       anything else: a quote is stored, and a bad point would be quoted again on every
 *       retry of the same request.</li>
 *   <li><b>The wallet.</b> The ride is anchored to the rider's account <em>now</em>,
 *       while his token (and therefore his phone) is in hand. Doing it later would mean
 *       the fare could not be reserved from a dispatcher's assign call, where nobody
 *       knows the rider's phone — and it fails earlier, on the screen where the rider
 *       can still fix it, instead of after he pressed "order".</li>
 *   <li><b>The price.</b> Route estimate, then tariff, then commission, all in integer
 *       minor units (see {@link FareCalculator}).</li>
 * </ol>
 *
 * <p>Nothing is reserved here: a quote costs the rider nothing and a rider who asks for
 * ten prices in a row must not freeze ten fares. The hold is placed at assignment, when
 * a car is actually claimed.
 */
@Service
@Slf4j
public class QuoteService {

    private final QuoteRepository quotes;
    private final RideAccountClient accounts;
    private final FareCalculator fareCalculator;
    private final RouteEstimator routeEstimator;
    private final TripProperties properties;
    private final Clock clock;

    public QuoteService(QuoteRepository quotes,
                        RideAccountClient accounts,
                        FareCalculator fareCalculator,
                        RouteEstimator routeEstimator,
                        TripProperties properties,
                        Clock clock) {
        this.quotes = quotes;
        this.accounts = accounts;
        this.fareCalculator = fareCalculator;
        this.routeEstimator = routeEstimator;
        this.properties = properties;
        this.clock = clock;
    }

    /** Prices the requested ride and stores the promise for {@code taxi.trip.quote-ttl}. */
    @Transactional
    public Quote quote(AuthenticatedUser rider, TripDtos.QuoteRequest request) {
        TripAccess.requireRider(rider);
        Tariff tariff = Tariff.of(request.tariff());

        TripDtos.PointRequest pickup = request.pickup();
        TripDtos.PointRequest dropoff = request.dropoff();
        GeoMath.requireValidCoordinates(pickup.lat(), pickup.lon(), "pickup");
        GeoMath.requireValidCoordinates(dropoff.lat(), dropoff.lon(), "dropoff");

        if (rider.phone() == null || rider.phone().isBlank()) {
            // The wallet is found by phone: a token without one cannot be paid from,
            // and saying so is better than a mysterious 422 later.
            throw DomainException.of(TripErrorCode.INVALID_TRIP_REQUEST,
                            "the caller's token carries no phone number, so no wallet can be found")
                    .withDetail("userId", rider.userId());
        }

        RideAccountClient.ResolvedAccount account = accounts.resolveByPhone(rider.phone(), properties.getCurrency());

        RouteEstimate route = routeEstimator.estimate(pickup.lat(), pickup.lon(), dropoff.lat(), dropoff.lon());
        FareQuote fare = fareCalculator.quote(tariff, route);

        Instant now = clock.instant();
        Quote quote = quotes.save(Quote.issue(
                rider.userId(),
                account.accountId(),
                tariff,
                pickup.lat(), pickup.lon(), pickup.address(),
                dropoff.lat(), dropoff.lon(), dropoff.address(),
                properties.getCurrency(),
                fare,
                now,
                properties.getQuoteTtl()));

        log.info("quoted {} {} for rider {} on {} ({} m, {} s) valid until {}",
                fare.priceMinor(), properties.getCurrency(), rider.userId(), tariff,
                route.distanceM(), route.durationS(), quote.getExpiresAt());
        return quote;
    }
}
