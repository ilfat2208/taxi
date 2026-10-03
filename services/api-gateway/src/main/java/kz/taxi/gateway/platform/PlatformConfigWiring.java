package kz.taxi.gateway.platform;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Wiring of the client configuration endpoint.
 *
 * <p>Only the properties are registered here. The {@code WebClient.Builder} is not declared:
 * a WebFlux application already publishes one (prototype-scoped), and a second bean of the
 * same type would make every injection by type ambiguous for no benefit.
 */
@Configuration
@EnableConfigurationProperties(PlatformConfigProperties.class)
public class PlatformConfigWiring {
}
