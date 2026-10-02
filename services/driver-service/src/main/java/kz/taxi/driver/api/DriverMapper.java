package kz.taxi.driver.api;

import kz.taxi.driver.api.dto.DriverDtos;
import kz.taxi.driver.domain.Driver;
import kz.taxi.driver.domain.DriverDocument;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * Domain to transport mapping.
 *
 * <p>Kept apart from the controller so that "what the client sees" is one file to
 * review. Note what is <em>not</em> exposed: no version, no internal ids of other
 * services.
 */
@Component
public class DriverMapper {

    public DriverDtos.DriverResponse toResponse(Driver driver, List<DriverDocument> documents) {
        return new DriverDtos.DriverResponse(
                driver.getId(),
                driver.getUserId(),
                driver.getPhone(),
                driver.getDisplayName(),
                driver.getStatus().name(),
                driver.getRatingBp(),
                driver.getCompletedTrips(),
                driver.getCurrentTripId(),
                driver.isOnDuty(),
                driver.isAvailable(),
                toDocuments(documents),
                driver.getCreatedAt());
    }

    public List<DriverDtos.DocumentResponse> toDocuments(List<DriverDocument> documents) {
        Instant now = Instant.now();
        return documents.stream()
                .map(document -> new DriverDtos.DocumentResponse(
                        document.getId(),
                        document.getKind().name(),
                        document.getExpiresAt(),
                        document.isValidAt(now)))
                .toList();
    }

    public DriverDtos.DocumentResponse toDocument(DriverDocument document) {
        return new DriverDtos.DocumentResponse(
                document.getId(),
                document.getKind().name(),
                document.getExpiresAt(),
                document.isValidAt(Instant.now()));
    }
}
