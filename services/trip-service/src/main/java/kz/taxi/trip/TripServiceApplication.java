package kz.taxi.trip;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Trip service: the ride itself — from "what would it cost" to "here is your check".
 *
 * <p>Owns four things that only make sense together and must never disagree:
 * <ul>
 *   <li><b>the quote</b> — a price the platform promised for a few minutes, without which
 *       a rider could order a car and be charged a different amount than the one he saw;</li>
 *   <li><b>the state machine</b> — SEARCHING, ASSIGNED, ARRIVED, IN_PROGRESS, COMPLETED
 *       and the three ways a ride ends without being performed. It decides when money may
 *       move, so it lives in the aggregate, not in a service;</li>
 *   <li><b>the money of the ride</b> — the fare reserved on the rider's account at
 *       assignment and captured at completion. The service holds no balance of its own:
 *       money is account-service's business, and this one only drives the reservation;</li>
 *   <li><b>the check</b> — the route, the three parts of the price, the platform's
 *       commission and what the driver earned.</li>
 * </ul>
 *
 * <p>What it deliberately does <em>not</em> own: where the cars are (dispatch-service
 * keeps positions in Redis, they are valid for seconds), whether a driver may work
 * (driver-service owns the documents and the duty state), and how a driver's net share
 * eventually reaches him — the payout step is not part of this phase, and
 * {@code Trip.driverNetMinor} is stored so that it can be built on a fact rather than on
 * a recomputation.
 *
 * <p>The two extra annotations exist because the platform ships the outbox entity and
 * repository in {@code common-kafka}: Spring Data and Hibernate must be told to scan that
 * package in addition to this service's own.
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.trip", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.trip", "kz.taxi.common.kafka.outbox"})
public class TripServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(TripServiceApplication.class, args);
    }
}
