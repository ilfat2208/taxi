package kz.taxi.qtime;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * QTime: the appointment core of the service verticals.
 *
 * <p>Owns one implementation of a calendar for the whole ecosystem — companies,
 * specialists, services, working hours and bookings — which Services, Beauty,
 * Health and Auto consume instead of each writing their own
 * (see {@code docs/orta.md} §3). The service deliberately knows nothing about the
 * verticals' own concepts (a leak, a car, a diagnosis): it knows who is free when,
 * and that is the only thing every vertical has in common.
 *
 * <p>What it does <em>not</em> do yet is take money: a booking is a claim on a
 * window, and the prepayment/hold through ORTA Pay, reminders and reviews are
 * announced as {@code booking.*} events on {@code qtime.events} for the verticals
 * and for ORTA Business to act on.
 *
 * <p>The two extra annotations exist because the platform ships the outbox entity
 * and repository in {@code common-kafka}: Spring Data and Hibernate must be told
 * to scan that package in addition to this service's own.
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.qtime", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.qtime", "kz.taxi.common.kafka.outbox"})
public class QtimeServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(QtimeServiceApplication.class, args);
    }
}
