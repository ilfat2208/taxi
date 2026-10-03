package kz.taxi.gateway.platform;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Where the gateway gets the blocks of the client configuration.
 *
 * <p>The gateway already knows these hosts — they are the same {@code *_SERVICE_URL}
 * variables its routes use. Reading them here from one more property would be a second
 * source of truth, so the defaults are identical and a deployment that sets the routes
 * sets this too (both read the same environment variable).
 *
 * @param tripServiceUrl    where the tariff catalogue lives
 * @param paymentServiceUrl where the payment methods live
 * @param cacheTtl          how long an assembled configuration is reused
 * @param timeout           how long a downstream call may take before its block is marked unavailable
 */
@ConfigurationProperties(prefix = "taxi.gateway.platform-config")
public record PlatformConfigProperties(String tripServiceUrl,
                                       String paymentServiceUrl,
                                       Duration cacheTtl,
                                       Duration timeout) {

    public static PlatformConfigProperties defaults() {
        return new PlatformConfigProperties(
                "http://127.0.0.1:8086",
                "http://127.0.0.1:8082",
                Duration.ofSeconds(30),
                Duration.ofSeconds(2));
    }
}
