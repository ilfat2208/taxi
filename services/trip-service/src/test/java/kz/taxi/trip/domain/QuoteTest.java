package kz.taxi.trip.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.trip.support.TestTrips;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The price promise: how long it lives and what it refuses.
 *
 * <p>A quote is the record of what the rider agreed to pay, so the tests are about the two
 * ways it can become unusable — it ran out of time, or it was already spent — and about the
 * price it carries, which must never be recomputed from the tariff of the moment.
 */
class QuoteTest {

    @Test
    @DisplayName("a fresh quote is usable and carries the whole price of the ride")
    void a_fresh_quote_carries_the_price() {
        Quote quote = TestTrips.quote();

        assertThat(quote.requireUsable(TestTrips.NOW)).isSameAs(quote);
        assertThat(quote.isExpired(TestTrips.NOW)).isFalse();
        assertThat(quote.isConsumed()).isFalse();
        assertThat(quote.getExpiresAt()).isEqualTo(TestTrips.NOW.plus(Duration.ofMinutes(5)));
        assertThat(quote.getPriceMinor()).isEqualTo(120_000L);
        assertThat(quote.getCommissionMinor()).isEqualTo(14_400L);
        assertThat(quote.getDriverNetMinor()).isEqualTo(105_600L);
        assertThat(quote.getCommissionBp()).isEqualTo(TestTrips.COMMISSION_BP);
        assertThat(quote.getBaseMinor() + quote.getDistanceMinor() + quote.getTimeMinor())
                .isEqualTo(quote.getPriceMinor());
        assertThat(quote.getRiderAccountId()).isEqualTo(TestTrips.RIDER_ACCOUNT);
    }

    @Test
    @DisplayName("an expired quote is refused rather than silently re-priced")
    void an_expired_quote_is_refused() {
        Quote quote = TestTrips.quote(TestTrips.RIDER, Tariff.ECONOMY, TestTrips.ROUTE,
                TestTrips.NOW, Duration.ofMinutes(5));

        assertThat(quote.isExpired(TestTrips.NOW.plus(Duration.ofMinutes(5)))).isTrue();
        assertThatThrownBy(() -> quote.requireUsable(TestTrips.NOW.plus(Duration.ofMinutes(5))))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_EXPIRED));
    }

    @Test
    @DisplayName("a quote is single-use: two cars from one promise is two fares")
    void a_quote_is_used_once() {
        Quote quote = TestTrips.quote();
        quote.consume("TRIP-1", TestTrips.NOW);

        assertThat(quote.isConsumed()).isTrue();
        assertThat(quote.getConsumedTripId()).isEqualTo("TRIP-1");
        assertThatThrownBy(() -> quote.consume("TRIP-2", TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_ALREADY_USED));
        assertThatThrownBy(() -> quote.requireUsable(TestTrips.NOW))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.QUOTE_ALREADY_USED));
    }

    @Test
    @DisplayName("a quote without a lifetime, or without a wallet, is a programming error")
    void a_quote_needs_a_lifetime_and_a_wallet() {
        assertThatThrownBy(() -> Quote.issue(TestTrips.RIDER, TestTrips.RIDER_ACCOUNT, Tariff.ECONOMY,
                43.2389d, 76.8897d, null, 43.25d, 76.9d, null,
                kz.taxi.common.core.money.Currency.KZT, TestTrips.fare(Tariff.ECONOMY, TestTrips.ROUTE),
                TestTrips.NOW, Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> Quote.issue(TestTrips.RIDER, "  ", Tariff.ECONOMY,
                43.2389d, 76.8897d, null, 43.25d, 76.9d, null,
                kz.taxi.common.core.money.Currency.KZT, TestTrips.fare(Tariff.ECONOMY, TestTrips.ROUTE),
                TestTrips.NOW, Duration.ofMinutes(5)))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND));
    }

    @Test
    @DisplayName("the tariff decides the price: comfort is dearer for the same route")
    void the_tariff_decides_the_price() {
        Quote economy = TestTrips.quote(TestTrips.RIDER, Tariff.ECONOMY);
        Quote comfort = TestTrips.quote(TestTrips.RIDER, Tariff.COMFORT);

        assertThat(comfort.getTariff()).isEqualTo(Tariff.COMFORT);
        assertThat(comfort.getPriceMinor()).isGreaterThan(economy.getPriceMinor());
        assertThat(comfort.getDistanceM()).isEqualTo(economy.getDistanceM());
    }

    @Test
    @DisplayName("a tariff is parsed case-insensitively and an unknown one is a 400")
    void tariffs_are_parsed_leniently_and_refused_clearly() {
        assertThat(Tariff.of("comfort")).isEqualTo(Tariff.COMFORT);
        assertThat(Tariff.of(" ECONOMY ")).isEqualTo(Tariff.ECONOMY);
        assertThatThrownBy(() -> Tariff.of("BUSINESS"))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TARIFF));
        assertThatThrownBy(() -> Tariff.of(null))
                .isInstanceOfSatisfying(DomainException.class, ex ->
                        assertThat(ex.errorCode()).isEqualTo(TripErrorCode.INVALID_TARIFF));
    }
}
