package kz.taxi.catalog.infrastructure.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Wires the catalog's own configuration.
 *
 * <p>{@code @EnableScheduling} is declared here rather than on the application
 * class so the dependency "this service has time-based work" is visible next to
 * the property that controls it (see {@code ReservationExpiryJob}).
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(CatalogProperties.class)
@EnableScheduling
public class CatalogConfiguration {
}
