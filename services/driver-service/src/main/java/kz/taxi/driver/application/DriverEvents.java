package kz.taxi.driver.application;

import java.time.Instant;

/**
 * Payloads of the events this service publishes to {@code driver.events}.
 *
 * <p>Flat and self-contained: dispatch reacts to a driver going on duty without
 * calling back into this service, which would re-introduce the coupling Kafka
 * exists to remove.
 */
public final class DriverEvents {

    private DriverEvents() {
    }

    /**
     * The driver changed duty state.
     *
     * <p>One event type for both directions rather than {@code driver.online} and
     * {@code driver.offline}: consumers care about the resulting state, and a
     * single shape means one handler instead of two that can drift apart. The
     * {@code eventType} still distinguishes them (`driver.online` /
     * `driver.offline`) so log filters stay readable.
     */
    public record DutyChanged(String driverId,
                              String userId,
                              String status,
                              Instant occurredAt) {
    }
}
