package kz.taxi.dispatch;

import kz.taxi.dispatch.infrastructure.DispatchProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * Dispatch service: where the fleet is, and who can take a trip right now.
 *
 * <p>Owns two very different things and keeps them apart:
 * <ul>
 *   <li><strong>positions</strong> — ephemeral, high volume, written every few
 *       seconds per driver, valuable for seconds and never replayed. They live in
 *       Redis (GEO index plus a TTL'd record), not in Kafka and not in Postgres:
 *       putting the raw GPS stream in a log would cost a lot and buy nothing
 *       (see {@code docs/adr/0009-taxi-vertical.md});</li>
 *   <li><strong>the fleet projection</strong> — durable facts about who is on duty,
 *       rebuilt from {@code driver.events}. It holds no driver profile of its own:
 *       the name and phone arrive with the event.</li>
 * </ul>
 *
 * <p>Deliberately without a database in Ф1: there is no trip yet to attach a track
 * to, and a service that stores nothing durable cannot silently become the owner
 * of somebody else's data.
 *
 * <p>JPA is switched off explicitly, and this is worth explaining: the platform's
 * outbox entity lives in {@code common-kafka}, so {@code spring-boot-starter-data-jpa}
 * arrives transitively and Spring Boot would try to build an {@code EntityManager}
 * over a datasource that does not exist. This service has no tables of its own, so
 * the honest configuration is to say so.
 */
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class, HibernateJpaAutoConfiguration.class})
@EnableConfigurationProperties(DispatchProperties.class)
public class DispatchServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(DispatchServiceApplication.class, args);
    }
}
