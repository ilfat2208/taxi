package kz.taxi.account;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Account service: the system of record for money.
 *
 * <p>Owns accounts and an append-only double-entry ledger. Balances are a
 * projection of the ledger, cached on the account row; every money movement goes
 * through a hold -> capture/release flow, so a payment can be compensated without
 * ever inventing or duplicating funds.
 *
 * <p>The two extra annotations exist because the platform ships the outbox entity
 * and repository in {@code common-kafka}: Spring Data and Hibernate must be told
 * to scan that package in addition to this service's own.
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.account", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.account", "kz.taxi.common.kafka.outbox"})
public class AccountServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(AccountServiceApplication.class, args);
    }
}
