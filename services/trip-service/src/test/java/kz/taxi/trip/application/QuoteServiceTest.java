package kz.taxi.trip.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.domain.Quote;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.TripErrorCode;
import kz.taxi.trip.infrastructure.QuoteRepository;
import kz.taxi.trip.infrastructure.TripProperties;
import kz.taxi.trip.infrastructure.client.RideAccountClient;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Quoting: the price a rider is shown, and the wallet it will be taken from.
 *
 * <p>Two decisions are worth watching here rather than in the domain. First, nothing is
 * reserved: a rider may ask for ten prices in a row and must not freeze ten fares. Second,
 * the wallet is resolved while the quote is made — the only moment the rider's token, and
 * therefore his phone, is available.
 */
@ExtendWith(MockitoExtension.class)
class QuoteServiceTest {

    @Mock
    private QuoteRepository quotes;
    @Mock
    private RideAccountClient accounts;

    private QuoteService service;

    @BeforeEach
    void setUp() {
        TripProperties properties = new TripProperties();
        service = new QuoteService(quotes, accounts, TestTrips.calculator(), TestTrips.estimator(),
                properties, Clock.fixed(TestTrips.NOW, ZoneOffset.UTC));
    }

    private static AuthenticatedUser rider() {
        return new AuthenticatedUser(TestTrips.RIDER, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    }

    private static TripDtos.QuoteRequest request(String tariff) {
        return new TripDtos.QuoteRequest(
                new TripDtos.PointRequest(43.2389d, 76.8897d, "Абая 150"),
                new TripDtos.PointRequest(43.2489d, 76.8897d, "Достык 5"),
                tariff);
    }

    @Test
    @DisplayName("a quote is priced, anchored to the rider's wallet and stored with its TTL")
    void a_quote_is_priced_and_stored() {
        when(accounts.resolveByPhone("+77001234567", Currency.KZT))
                .thenReturn(new RideAccountClient.ResolvedAccount(TestTrips.RIDER_ACCOUNT, TestTrips.RIDER,
                        "KZT", "ACTIVE"));
        when(quotes.save(any(Quote.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Quote quote = service.quote(rider(), request("ECONOMY"));

        assertThat(quote.getTariff()).isEqualTo(Tariff.ECONOMY);
        assertThat(quote.getRiderUserId()).isEqualTo(TestTrips.RIDER);
        assertThat(quote.getRiderAccountId()).isEqualTo(TestTrips.RIDER_ACCOUNT);
        assertThat(quote.getCurrency()).isEqualTo(Currency.KZT);
        assertThat(quote.getDistanceM()).isGreaterThan(1_000);
        assertThat(quote.getDurationS()).isGreaterThan(180);
        assertThat(quote.getPriceMinor()).isPositive();
        assertThat(quote.getBaseMinor() + quote.getDistanceMinor() + quote.getTimeMinor())
                .isEqualTo(quote.getPriceMinor());
        assertThat(quote.getDriverNetMinor() + quote.getCommissionMinor()).isEqualTo(quote.getPriceMinor());
        assertThat(quote.getExpiresAt()).isEqualTo(TestTrips.NOW.plusSeconds(300));
        // A quote costs nothing: the fare is only reserved when a car is actually claimed.
        verify(accounts, never()).placeHold(any());
    }

    @Test
    @DisplayName("comfort is quoted from its own price list")
    void comfort_is_priced_from_its_own_rates() {
        when(accounts.resolveByPhone(anyString(), any(Currency.class)))
                .thenReturn(new RideAccountClient.ResolvedAccount(TestTrips.RIDER_ACCOUNT, TestTrips.RIDER,
                        "KZT", "ACTIVE"));
        when(quotes.save(any(Quote.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Quote economy = service.quote(rider(), request("economy"));
        Quote comfort = service.quote(rider(), request("COMFORT"));

        assertThat(economy.getTariff()).isEqualTo(Tariff.ECONOMY);
        assertThat(comfort.getTariff()).isEqualTo(Tariff.COMFORT);
        assertThat(comfort.getPriceMinor()).isGreaterThan(economy.getPriceMinor());
        assertThat(comfort.getDistanceM()).isEqualTo(economy.getDistanceM());
    }

    @Test
    @DisplayName("the wallet is resolved from the token's phone number, not from a body field")
    void the_wallet_comes_from_the_token() {
        when(accounts.resolveByPhone("+77001234567", Currency.KZT))
                .thenReturn(new RideAccountClient.ResolvedAccount(TestTrips.RIDER_ACCOUNT, TestTrips.RIDER,
                        "KZT", "ACTIVE"));
        when(quotes.save(any(Quote.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.quote(rider(), request("ECONOMY"));

        verify(accounts).resolveByPhone("+77001234567", Currency.KZT);
        verify(accounts, never()).placeHold(any());
    }

    @Test
    @DisplayName("a rider without a wallet is told to open one instead of being quoted a price")
    void a_rider_without_a_wallet_is_refused() {
        when(accounts.resolveByPhone(anyString(), any(Currency.class)))
                .thenThrow(DomainException.of(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND, "no wallet"));

        assertThatThrownBy(() -> service.quote(rider(), request("ECONOMY")))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND));

        verify(quotes, never()).save(any(Quote.class));
    }

    @Test
    @DisplayName("a token without a phone cannot be paid from, and says so")
    void a_token_without_a_phone_is_refused() {
        AuthenticatedUser anonymousPhone =
                new AuthenticatedUser(TestTrips.RIDER, null, "Айша", Set.of(Roles.CUSTOMER));

        assertThatThrownBy(() -> service.quote(anonymousPhone, request("ECONOMY")))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TRIP_REQUEST));

        verifyNoInteractions(accounts);
    }

    @Test
    @DisplayName("only a customer is quoted a price")
    void only_a_customer_is_quoted() {
        AuthenticatedUser driver =
                new AuthenticatedUser("U-DRIVER", "+77001234567", "Айдар", Set.of(Roles.DRIVER));

        assertThatThrownBy(() -> service.quote(driver, request("ECONOMY")))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.FORBIDDEN_TRIP_ACCESS));

        verifyNoInteractions(accounts, quotes);
    }

    @Test
    @DisplayName("an impossible pickup point is refused before the wallet is even resolved")
    void an_impossible_point_is_refused_first() {
        TripDtos.QuoteRequest bad = new TripDtos.QuoteRequest(
                new TripDtos.PointRequest(143.2389d, 76.8897d, "нигде"),
                new TripDtos.PointRequest(43.2489d, 76.8897d, "Достык 5"),
                "ECONOMY");

        assertThatThrownBy(() -> service.quote(rider(), bad))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_COORDINATES));

        verifyNoInteractions(accounts, quotes);
    }

    @Test
    @DisplayName("an unknown tariff is a 400, and it costs no round trip")
    void an_unknown_tariff_is_refused() {
        assertThatThrownBy(() -> service.quote(rider(), request("BUSINESS")))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TARIFF));

        verifyNoInteractions(accounts, quotes);
    }

    @Test
    @DisplayName("the quote's TTL comes from configuration, not from the code")
    void the_ttl_comes_from_configuration() {
        TripProperties properties = new TripProperties();
        properties.setQuoteTtl(java.time.Duration.ofMinutes(2));
        QuoteService shortLived = new QuoteService(quotes, accounts, TestTrips.calculator(),
                TestTrips.estimator(), properties, Clock.fixed(Instant.parse("2025-05-01T10:00:00Z"), ZoneOffset.UTC));
        when(accounts.resolveByPhone(anyString(), any(Currency.class)))
                .thenReturn(new RideAccountClient.ResolvedAccount(TestTrips.RIDER_ACCOUNT, TestTrips.RIDER,
                        "KZT", "ACTIVE"));
        when(quotes.save(any(Quote.class))).thenAnswer(invocation -> invocation.getArgument(0));

        Quote quote = shortLived.quote(rider(), request("ECONOMY"));

        assertThat(quote.getExpiresAt()).isEqualTo(Instant.parse("2025-05-01T10:02:00Z"));
    }
}
