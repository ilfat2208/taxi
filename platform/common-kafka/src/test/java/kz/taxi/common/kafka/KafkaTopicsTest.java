package kz.taxi.common.kafka;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KafkaTopicsTest {

    @Test
    @DisplayName("declares one topic per bounded context plus a dead-letter companion")
    void declares_topics_and_dlts() {
        List<String> topics = KafkaTopics.all();

        assertThat(topics).containsExactly(
                "account.events", "payment.events", "catalog.events", "order.events", "settlement.events",
                "trip.events", "driver.events", "dispatch.events", "qtime.events");
        assertThat(new HashSet<>(topics)).hasSameSizeAs(topics);
        assertThat(KafkaTopics.deadLetterTopics())
                .hasSameSizeAs(topics)
                .allSatisfy(topic -> assertThat(topic).endsWith(".DLT"));
        assertThat(KafkaTopics.deadLetterFor("payment.events")).isEqualTo("payment.events.DLT");
        assertThat(KafkaTopics.deadLetterFor("settlement.events")).isEqualTo("settlement.events.DLT");
    }

    @Test
    @DisplayName("settlement has its own topic, not a slice of payment.events")
    void settlement_is_its_own_context() {
        // Merchant payouts are a different bounded context with different consumers
        // (accounting, merchant notifications) and must be replayable without
        // replaying every customer payment.
        assertThat(KafkaTopics.SETTLEMENT_EVENTS).isNotEqualTo(KafkaTopics.PAYMENT_EVENTS);
        assertThat(List.of(
                        KafkaTopics.Events.SETTLEMENT_CREATED,
                        KafkaTopics.Events.SETTLEMENT_PAID,
                        KafkaTopics.Events.SETTLEMENT_FAILED))
                .containsExactly("settlement.created", "settlement.paid", "settlement.failed");
    }

    @Test
    @DisplayName("uses namespaced, dotted event type names")
    void uses_namespaced_event_types() {
        assertThat(List.of(
                        KafkaTopics.Events.ACCOUNT_BALANCE_CHANGED,
                        KafkaTopics.Events.PAYMENT_COMPLETED,
                        KafkaTopics.Events.STOCK_RESERVED,
                        KafkaTopics.Events.ORDER_PAID))
                .allSatisfy(event -> assertThat(event).contains(".").isLowerCase());
    }

    @Test
    @DisplayName("payment lifecycle events are complete enough to drive a saga")
    void covers_payment_lifecycle() {
        assertThat(List.of(
                        KafkaTopics.Events.PAYMENT_INITIATED,
                        KafkaTopics.Events.PAYMENT_COMPLETED,
                        KafkaTopics.Events.PAYMENT_FAILED,
                        KafkaTopics.Events.PAYMENT_REVERSED))
                .containsExactlyInAnyOrder(
                        "payment.initiated", "payment.completed", "payment.failed", "payment.reversed");
    }

    @Test
    @DisplayName("QTime publishes one calendar, so every service vertical reads one topic")
    void covers_booking_lifecycle() {
        // QTime is the single calendar behind Beauty, Health, Auto and Services: the
        // verticals filter by eventType and company, they do not get a topic each.
        assertThat(List.of(
                        KafkaTopics.Events.BOOKING_CREATED,
                        KafkaTopics.Events.BOOKING_CANCELLED,
                        KafkaTopics.Events.BOOKING_COMPLETED))
                .containsExactly("booking.created", "booking.cancelled", "booking.completed");
        assertThat(KafkaTopics.QTIME_EVENTS).isEqualTo("qtime.events");
        assertThat(KafkaTopics.all()).contains(KafkaTopics.QTIME_EVENTS);
    }
}
