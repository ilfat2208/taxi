package kz.taxi.driver.infrastructure;

import kz.taxi.driver.domain.Driver;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface DriverRepository extends JpaRepository<Driver, String> {

    Optional<Driver> findByUserId(String userId);

    boolean existsByUserId(String userId);
}
