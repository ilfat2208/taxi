package kz.taxi.trip.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Addresses and timeouts of the three services a ride depends on.
 *
 * <p>Timeouts are configuration, not constants, and they are the difference between a
 * request that fails fast and one that holds a rider's screen for two minutes. They
 * matter most on the money path: a call to the account service that hangs keeps the
 * rider's fare reserved with nothing to show for it, so the read timeout is short and
 * a failure surfaces as {@code DOWNSTREAM_UNAVAILABLE} rather than as a slow success.
 *
 * @param accountService  where the fare is reserved and captured
 * @param dispatchService where the nearest available car is asked for
 * @param driverService   where a driver is claimed and released
 */
@ConfigurationProperties(prefix = "taxi.clients")
public record TripClientProperties(Endpoint accountService,
                                   Endpoint dispatchService,
                                   Endpoint driverService) {

    public TripClientProperties {
        accountService = Endpoint.orDefault(accountService);
        dispatchService = Endpoint.orDefault(dispatchService);
        driverService = Endpoint.orDefault(driverService);
    }

    public record Endpoint(String url, Duration connectTimeout, Duration readTimeout) {

        private static final Duration DEFAULT_CONNECT_TIMEOUT = Duration.ofSeconds(2);
        private static final Duration DEFAULT_READ_TIMEOUT = Duration.ofSeconds(5);

        public Endpoint {
            url = url == null ? "" : stripTrailingSlashes(url.trim());
            connectTimeout = positiveOrDefault(connectTimeout, DEFAULT_CONNECT_TIMEOUT);
            readTimeout = positiveOrDefault(readTimeout, DEFAULT_READ_TIMEOUT);
        }

        static Endpoint orDefault(Endpoint endpoint) {
            return endpoint == null ? new Endpoint(null, null, null) : endpoint;
        }

        public boolean isConfigured() {
            return !url.isBlank();
        }

        private static String stripTrailingSlashes(String value) {
            int end = value.length();
            while (end > 0 && value.charAt(end - 1) == '/') {
                end--;
            }
            return value.substring(0, end);
        }

        private static Duration positiveOrDefault(Duration value, Duration fallback) {
            return value == null || value.isZero() || value.isNegative() ? fallback : value;
        }
    }
}
