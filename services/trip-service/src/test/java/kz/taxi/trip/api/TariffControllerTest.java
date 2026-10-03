package kz.taxi.trip.api;

import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.infrastructure.TripProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The public price list.
 *
 * <p>What matters here is not the formatting but the agreement: the endpoint must publish
 * exactly the rates the pricing engine uses. A tariff picker that shows 120 ₸/км while the
 * quote charges 150 is worse than no picker at all, so the test reads the same
 * {@link TripProperties} the engine reads.
 */
class TariffControllerTest {

    private final TripProperties properties = new TripProperties();

    private final TariffController controller = new TariffController(properties);

    @Test
    @DisplayName("публикует все тарифы с коэффициентами из конфигурации")
    void publishes_every_tariff_from_configuration() {
        TripDtos.TariffCatalogueResponse response = controller.tariffs();

        assertThat(response.currency()).isEqualTo("KZT");
        assertThat(response.commissionBp()).isEqualTo(properties.getCommissionBp());
        assertThat(response.quoteTtlSeconds()).isEqualTo(properties.getQuoteTtl().toSeconds());
        assertThat(response.tariffs()).extracting(TripDtos.TariffView::code)
                .containsExactlyElementsOf(java.util.Arrays.stream(Tariff.values()).map(Enum::name).toList());

        TripDtos.TariffView economy = response.tariffs().stream()
                .filter(view -> view.code().equals(Tariff.ECONOMY.name()))
                .findFirst()
                .orElseThrow();
        assertThat(economy.baseMinor()).isEqualTo(properties.getTariffs().get(Tariff.ECONOMY).baseMinor());
        assertThat(economy.perKmMinor()).isEqualTo(properties.getTariffs().get(Tariff.ECONOMY).perKmMinor());
        assertThat(economy.minFareMinor()).isPositive();
    }

    @Test
    @DisplayName("изменение конфигурации видно в ответе: второго источника правды нет")
    void a_changed_rate_shows_up_in_the_response() {
        properties.getTariffs().put(Tariff.ECONOMY,
                new kz.taxi.trip.domain.TariffRates(40_000L, 15_000L, 3_000L, 60_000L));

        TripDtos.TariffView economy = controller.tariffs().tariffs().stream()
                .filter(view -> view.code().equals(Tariff.ECONOMY.name()))
                .findFirst()
                .orElseThrow();

        assertThat(economy.perKmMinor()).isEqualTo(15_000L);
        assertThat(economy.baseMinor()).isEqualTo(40_000L);
    }

    @Test
    @DisplayName("в ответе сказано, что тарифы — конфигурация, а не данные из базы")
    void the_note_explains_where_the_prices_come_from() {
        assertThat(controller.tariffs().note()).contains("конфигурация");
    }
}
