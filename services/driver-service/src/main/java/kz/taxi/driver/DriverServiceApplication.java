package kz.taxi.driver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Driver service: who is allowed to take trips.
 *
 * <p>Owns the driver profile, the vehicle and the documents that expire. The
 * service deliberately does <em>not</em> know where drivers are: positions are
 * ephemeral and live in dispatch-service (see {@code docs/adr/0009-taxi-vertical.md}).
 * What lives here is the durable part — the right to go on duty at all.
 *
 * <p>The two extra annotations exist because the platform ships the outbox entity
 * and repository in {@code common-kafka}: Spring Data and Hibernate must be told
 * to scan that package in addition to this service's own.
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.driver", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.driver", "kz.taxi.common.kafka.outbox"})
public class DriverServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(DriverServiceApplication.class, args);
    }
}
