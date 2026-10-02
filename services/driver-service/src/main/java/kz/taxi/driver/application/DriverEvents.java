package kz.taxi.driver.application;

import java.time.Instant;

/**
 * Payloads of the events this service publishes to {@code driver.events}.
 *
 * <p>Flat and self-contained: dispatch builds its live fleet view from these
 * events without calling back into this service, which would re-introduce the
 * coupling Kafka exists to remove. That is why the name and the phone travel with
 * every state change — a consumer must never have to go and ask who a driver is.
 */
public final class DriverEvents {

    private DriverEvents() {
    }

    /**
     * The driver's state changed: registered, went on duty, took a trip, went off
     * duty.
     *
     * <p>One shape for all of them rather than a class per transition: consumers
     * care about the resulting state, and a single record means one handler
     * instead of four that drift apart. The {@code eventType} still distinguishes
     * them ({@code driver.registered}, {@code driver.online}, {@code driver.busy},
     * {@code driver.offline}) so log filters and metrics stay readable.
     */
    public record DriverStateChanged(String driverId,
                                     String userId,
                                     String displayName,
                                     String phone,
                                     String status,
                                     Instant occurredAt) {
    }
}
