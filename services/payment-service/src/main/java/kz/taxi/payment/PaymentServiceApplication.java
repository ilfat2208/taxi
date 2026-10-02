package kz.taxi.payment;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Payment service: orchestrates money movement.
 *
 * <p>Owns no balances — it owns the <em>lifecycle</em> of a payment and drives
 * the account service through it (hold, capture, release). Every state
 * transition is persisted before the next remote call, which is what makes the
 * saga restartable after a crash: an INITIATED payment is always resolvable by
 * asking the account service which holds exist for it.
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.payment", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.payment", "kz.taxi.common.kafka.outbox"})
public class PaymentServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(PaymentServiceApplication.class, args);
    }
}
