package kz.taxi.order.infrastructure.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * Registers the order service's own configuration properties.
 *
 * <p>A dedicated class rather than a scan of the package: a service should be able
 * to say exactly which properties it binds, and an accidental
 * {@code @ConfigurationProperties} record in a test source set should never change
 * the production context.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(OrderProperties.class)
public class OrderConfiguration {
}
