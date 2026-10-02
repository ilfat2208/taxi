package kz.taxi.trip.infrastructure;

import kz.taxi.common.core.money.Currency;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.TariffRates;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The tariffs, as the configuration file spells them out.
 *
 * <p>This test reads {@code application.yml} and binds the real {@code taxi.trip} block. It
 * exists because prices are configuration by design, and configuration that nobody binds is
 * configuration that silently does nothing: a misspelled {@code per-minute-minor} would leave
 * the time component at zero and a support agent would find out from a rider. Binding is
 * therefore verified, and a tariff that cannot price a ride is shown to stop the service at
 * startup rather than at the first customer.
 */
class TripPropertiesTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withUserConfiguration(PropertiesConfig.class);

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(TripProperties.class)
    static class PropertiesConfig {
    }

    @Test
    @DisplayName("the price list of the pilot city is bound from the configuration file")
    void tariffs_are_bound_from_the_configuration_file() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            TripProperties properties = context.getBean(TripProperties.class);

            assertThat(properties.getCurrency()).isEqualTo(Currency.KZT);
            assertThat(properties.getCommissionBp()).isEqualTo(1_200);
            assertThat(properties.getQuoteTtl()).isEqualTo(Duration.ofMinutes(5));
            assertThat(properties.getPickupTime()).isEqualTo(Duration.ofMinutes(3));
            assertThat(properties.getRoadFactor()).isEqualTo(1.35d);
            assertThat(properties.getAverageSpeedKph()).isEqualTo(28d);

            TariffRates economy = properties.getTariffs().get(Tariff.ECONOMY);
            assertThat(economy).isEqualTo(new TariffRates(35_000L, 12_000L, 2_500L, 50_000L));
            TariffRates comfort = properties.getTariffs().get(Tariff.COMFORT);
            assertThat(comfort).isEqualTo(new TariffRates(60_000L, 18_000L, 3_500L, 80_000L));
            assertThat(comfort.perKmMinor()).isGreaterThan(economy.perKmMinor());
        });
    }

    @Test
    @DisplayName("a tariff without a base fare stops the service instead of reaching a rider")
    void an_incomplete_tariff_stops_the_startup() {
        runner.withPropertyValues("taxi.trip.tariffs.ECONOMY.base-minor=0")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseInstanceOf(IllegalStateException.class)
                            .rootCause()
                            .hasMessageContaining("tariffs.ECONOMY");
                });
    }

    @Test
    @DisplayName("a tariff without a minimum fare is incomplete too")
    void a_minimum_fare_is_required() {
        runner.withPropertyValues("taxi.trip.tariffs.COMFORT.min-fare-minor=0")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .rootCause()
                            .hasMessageContaining("tariffs.COMFORT");
                });
    }

    @Test
    @DisplayName("a per-kilometre rate may not be a value the service cannot multiply")
    void nonsensical_rates_are_refused() {
        runner.withPropertyValues("taxi.trip.tariffs.ECONOMY.per-km-minor=-1")
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    @DisplayName("a commission of 100% or more, or a detour factor below one, is a configuration error")
    void nonsensical_platform_settings_are_refused() {
        runner.withPropertyValues("taxi.trip.commission-bp=10000")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure()).rootCause()
                            .hasMessageContaining("commission-bp");
                });
        runner.withPropertyValues("taxi.trip.road-factor=0.8")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure()).rootCause()
                            .hasMessageContaining("road-factor");
                });
    }

    @Test
    @DisplayName("the downstream addresses and timeouts are bound, with defaults that are not zero")
    void clients_are_bound() {
        new ApplicationContextRunner()
                .withInitializer(new ConfigDataApplicationContextInitializer())
                .withUserConfiguration(ClientsConfig.class)
                .run(context -> {
                    TripClientProperties properties = context.getBean(TripClientProperties.class);

                    assertThat(properties.accountService().url()).isEqualTo("http://127.0.0.1:8081");
                    assertThat(properties.dispatchService().url()).isEqualTo("http://127.0.0.1:8087");
                    assertThat(properties.driverService().url()).isEqualTo("http://127.0.0.1:8085");
                    assertThat(properties.accountService().connectTimeout()).isEqualTo(Duration.ofSeconds(2));
                    assertThat(properties.accountService().readTimeout()).isEqualTo(Duration.ofSeconds(5));
                    // A missing timeout must never mean "wait forever" on the money path.
                    assertThat(properties.driverService().readTimeout()).isPositive();
                });
    }

    @Configuration(proxyBeanMethods = false)
    @EnableConfigurationProperties(TripClientProperties.class)
    static class ClientsConfig {
    }
}
