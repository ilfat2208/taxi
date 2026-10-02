package kz.taxi.order;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Order service: checkout, the place where the whole platform meets.
 *
 * <p>A checkout is a saga across three services and one asynchronous hop:
 * <pre>
 *   cart -> order(PENDING_PAYMENT)
 *        -> catalog: reserve stock
 *        -> payment: create merchant payment
 *        -> [payment.completed arrives on Kafka]
 *        -> order(PAID), catalog: commit stock
 * </pre>
 *
 * <p>Each step is compensated if the next one fails, and the order row plus its
 * outbox row always commit together, so a crash mid-saga leaves a recoverable
 * state instead of a charge with no order.
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.order", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.order", "kz.taxi.common.kafka.outbox"})
public class OrderServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(OrderServiceApplication.class, args);
    }
}
