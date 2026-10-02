package kz.taxi.dispatch.infrastructure.kafka;

import java.time.Instant;

/**
 * Payload of {@code driver.events} as published by driver-service.
 *
 * <p>Declared again here rather than imported from the driver module on purpose:
 * services must not share classes, only contracts. If the producer adds a field,
 * this record simply ignores it until somebody needs it — a shared class would
 * silently couple the two release cycles.
 */
public record DriverStateEvent(String driverId,
                              String userId,
                              String displayName,
                              String phone,
                              String status,
                              Instant occurredAt) {
}
