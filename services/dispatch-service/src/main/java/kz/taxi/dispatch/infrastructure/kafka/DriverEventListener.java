package kz.taxi.dispatch.infrastructure.kafka;

import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.consumer.IdempotentEventHandler;
import kz.taxi.dispatch.application.FleetService;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * How the fleet projection learns about drivers.
 *
 * <p>{@code driver.events} is the only source: dispatch never asks driver-service
 * who is on duty. The trade is explicit — the view is eventually consistent, so a
 * driver may miss a trip for the second or two it takes the event to arrive, and
 * in exchange the candidate search does not depend on a neighbouring service
 * being up.
 *
 * <p>At-least-once delivery is handled by the platform: {@link IdempotentEventHandler}
 * claims the {@code eventId} before this handler runs and releases it on failure,
 * so a redelivered {@code driver.online} cannot corrupt the projection.
 */
@Component
@Slf4j
public class DriverEventListener {

    /** Consumer name of the dedup store: one entry per service, not per topic. */
    public static final String CONSUMER_NAME = "dispatch-service";

    private final IdempotentEventHandler idempotentEventHandler;
    private final FleetService fleetService;

    public DriverEventListener(IdempotentEventHandler idempotentEventHandler, FleetService fleetService) {
        this.idempotentEventHandler = idempotentEventHandler;
        this.fleetService = fleetService;
    }

    @KafkaListener(topics = KafkaTopics.DRIVER_EVENTS,
            groupId = "${spring.kafka.consumer.group-id:dispatch-service}")
    public void onDriverEvent(ConsumerRecord<String, String> record) {
        idempotentEventHandler.handleOnce(CONSUMER_NAME, record, DriverStateEvent.class, this::handle);
    }

    private void handle(EventEnvelope<DriverStateEvent> envelope) {
        DriverStateEvent payload = envelope.payload();
        if (payload == null || payload.driverId() == null || payload.status() == null) {
            // Not a state change we can act on; the topic is shared and may carry
            // event types this service does not know yet.
            log.debug("ignoring driver event {} without a usable payload", envelope.eventType());
            return;
        }
        fleetService.applyDriverState(envelope.eventType(), payload);
    }
}
