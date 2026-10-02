package kz.taxi.qtime.infrastructure;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * Wires QTime's own configuration.
 *
 * <p>The {@link Clock} is a bean rather than a call to {@code Instant.now()} scattered
 * through the services: "свободно ли 15:30" is a question about the current moment, the
 * lead time and the horizon at once, and a test that cannot move that moment cannot
 * check any of the three without sleeping. Nothing else is wired here — the service has
 * no scheduled jobs yet (reminders and no-show marking arrive with the CRM screens),
 * which is why there is no {@code @EnableScheduling}.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(QtimeProperties.class)
public class QtimeConfiguration {

    /** UTC: every instant the service stores is absolute, local time exists only in rules and responses. */
    @Bean
    public Clock qtimeClock() {
        return Clock.systemUTC();
    }
}
