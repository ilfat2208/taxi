package kz.taxi.driver.infrastructure;

import kz.taxi.driver.domain.DocumentKind;
import kz.taxi.driver.domain.DriverDocument;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface DriverDocumentRepository extends JpaRepository<DriverDocument, String> {

    List<DriverDocument> findByDriverIdOrderByKindAsc(String driverId);

    Optional<DriverDocument> findByDriverIdAndKind(String driverId, DocumentKind kind);
}
