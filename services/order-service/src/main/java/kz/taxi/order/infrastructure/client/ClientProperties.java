package kz.taxi.order.infrastructure.client;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Addresses and timeouts of the services this one calls.
 *
 * <p>Timeouts are configuration, not constants, because they are the difference
 * between a saga that fails fast and one that holds a customer's request open for
 * two minutes. They also decide when an outcome becomes "unknown": once the read
 * timeout fires, the order service stops guessing and hands the decision to the
 * recovery job.
 *
 * <p>All requests are time bounded on purpose — an unbounded read timeout on a
 * checkout means a thread parked until the OS gives up, which is how a downstream
 * incident becomes an outage here.
 *
 * @param catalogService catalog base URL and timeouts
 * @param paymentService payment base URL and timeouts
 */
@ConfigurationProperties(prefix = "taxi.clients")
public record ClientProperties(Endpoint catalogService, Endpoint paymentService) {

    public ClientProperties {
        catalogService = Endpoint.orDefault(catalogService);
        paymentService = Endpoint.orDefault(paymentService);
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
            return endpoint == null
                    ? new Endpoint(null, null, null)
                    : endpoint;
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
