package kz.taxi.catalog;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Catalog service: the marketplace.
 *
 * <p>Owns merchants, products and stock. Stock uses a reservation model rather
 * than a direct decrement: checkout reserves quantity while the payment is in
 * flight, then commits or releases it. Without that, an abandoned checkout would
 * silently remove sellable inventory (or, worse, oversell it).
 */
@SpringBootApplication
@EntityScan(basePackages = {"kz.taxi.catalog", "kz.taxi.common.kafka.outbox"})
@EnableJpaRepositories(basePackages = {"kz.taxi.catalog", "kz.taxi.common.kafka.outbox"})
public class CatalogServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(CatalogServiceApplication.class, args);
    }
}
