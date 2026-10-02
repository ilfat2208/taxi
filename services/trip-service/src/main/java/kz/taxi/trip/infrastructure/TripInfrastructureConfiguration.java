package kz.taxi.trip.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.trip.domain.FareCalculator;
import kz.taxi.trip.domain.RouteEstimator;
import kz.taxi.trip.infrastructure.client.DownstreamErrors;
import kz.taxi.trip.infrastructure.client.DriverFinder;
import kz.taxi.trip.infrastructure.client.DriverRoster;
import kz.taxi.trip.infrastructure.client.HttpDriverFinder;
import kz.taxi.trip.infrastructure.client.HttpDriverRoster;
import kz.taxi.trip.infrastructure.client.HttpRideAccountClient;
import kz.taxi.trip.infrastructure.client.RideAccountClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.time.Clock;
import java.time.Duration;

/**
 * Wires the pricing rules and the three downstream clients.
 *
 * <p>The {@link RestClient}s are built from the auto-configured
 * {@code RestClient.Builder}, which the platform has already customised with the
 * outbound interceptor. That is the whole trick: {@code Authorization},
 * {@code X-Internal-Token} and {@code X-Correlation-Id} travel with every call without
 * a line of code here, which is why a call made while serving a rider (a user token
 * exists) and a call made from a dispatcher's console behave correctly on their own.
 *
 * <p>Only the request factory is replaced, to put a connect and a read timeout on each
 * call. Everything else — message converters, error handling, the interceptor — stays
 * as the platform configured it.
 *
 * <p>Everything is {@code @ConditionalOnMissingBean} so a test can replace a client
 * with a stub and still exercise the real saga, the real state machine and the real
 * outbox.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({TripProperties.class, TripClientProperties.class})
public class TripInfrastructureConfiguration {

    /**
     * Pricing as a bean, built from configuration.
     *
     * <p>The calculator itself is plain domain code with no Spring in it; this is the
     * one place that knows a price list comes from {@code taxi.trip.tariffs}.
     */
    @Bean
    @ConditionalOnMissingBean
    public FareCalculator fareCalculator(TripProperties properties) {
        return new FareCalculator(properties.getTariffs(), properties.getCommissionBp());
    }

    @Bean
    @ConditionalOnMissingBean
    public RouteEstimator routeEstimator(TripProperties properties) {
        return new RouteEstimator(properties.getRoadFactor(), properties.getAverageSpeedKph(),
                properties.getPickupTime());
    }

    /** Time as a dependency: a quote's TTL is a business rule and has to be testable. */
    @Bean
    @ConditionalOnMissingBean
    public Clock tripClock() {
        return Clock.systemUTC();
    }

    @Bean
    @ConditionalOnMissingBean
    public DownstreamErrors downstreamErrors(ObjectMapper objectMapper) {
        return new DownstreamErrors(objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean(name = "accountServiceRestClient")
    public RestClient accountServiceRestClient(RestClient.Builder builder, TripClientProperties properties) {
        return restClient(builder, properties.accountService());
    }

    @Bean
    @ConditionalOnMissingBean(name = "dispatchServiceRestClient")
    public RestClient dispatchServiceRestClient(RestClient.Builder builder, TripClientProperties properties) {
        return restClient(builder, properties.dispatchService());
    }

    @Bean
    @ConditionalOnMissingBean(name = "driverServiceRestClient")
    public RestClient driverServiceRestClient(RestClient.Builder builder, TripClientProperties properties) {
        return restClient(builder, properties.driverService());
    }

    @Bean
    @ConditionalOnMissingBean
    public RideAccountClient rideAccountClient(RestClient accountServiceRestClient, DownstreamErrors errors) {
        return new HttpRideAccountClient(accountServiceRestClient, errors);
    }

    @Bean
    @ConditionalOnMissingBean
    public DriverFinder driverFinder(RestClient dispatchServiceRestClient, DownstreamErrors errors) {
        return new HttpDriverFinder(dispatchServiceRestClient, errors);
    }

    @Bean
    @ConditionalOnMissingBean
    public DriverRoster driverRoster(RestClient driverServiceRestClient, DownstreamErrors errors) {
        return new HttpDriverRoster(driverServiceRestClient, errors);
    }

    private static RestClient restClient(RestClient.Builder builder, TripClientProperties.Endpoint endpoint) {
        if (endpoint.isConfigured()) {
            builder.baseUrl(endpoint.url());
        }
        builder.requestFactory(requestFactory(endpoint));
        return builder.build();
    }

    private static ClientHttpRequestFactory requestFactory(TripClientProperties.Endpoint endpoint) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(toMillis(endpoint.connectTimeout()));
        factory.setReadTimeout(toMillis(endpoint.readTimeout()));
        return factory;
    }

    private static int toMillis(Duration duration) {
        long millis = duration.toMillis();
        return millis > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) millis;
    }
}
