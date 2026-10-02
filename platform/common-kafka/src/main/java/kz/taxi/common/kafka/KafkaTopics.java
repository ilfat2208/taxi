package kz.taxi.common.kafka;

import java.util.List;

/**
 * Topic catalogue.
 *
 * <p>One topic per bounded context (not per event type): Kafka orders records
 * only within a partition, so keeping a context's events together with the
 * aggregate id as the message key gives per-aggregate ordering, while consumers
 * still filter by {@code eventType} — which is exactly what a saga needs.
 *
 * <p>{@code <topic>.DLT} holds records that exhausted their retries. A DLT is
 * not a graveyard: it is an operational queue that must be monitored and
 * replayed, and every service owning a topic owns its DLT too.
 */
public final class KafkaTopics {

    /** Events published by the account service: ledger postings, holds. */
    public static final String ACCOUNT_EVENTS = "account.events";
    /** Events published by the payment service: money movement lifecycle. */
    public static final String PAYMENT_EVENTS = "payment.events";
    /** Events published by the catalog service: products and stock. */
    public static final String CATALOG_EVENTS = "catalog.events";
    /** Events published by the order service: checkout lifecycle. */
    public static final String ORDER_EVENTS = "order.events";
    /**
     * Events published when the platform settles with a merchant.
     *
     * <p>Settlement is its own topic rather than more {@code payment.events}: it is a
     * different bounded context (money owed to merchants on a schedule, not a
     * customer's payment), it has different consumers (accounting, merchant
     * notifications) and it must be replayable without replaying every payment.
     */
    public static final String SETTLEMENT_EVENTS = "settlement.events";

    public static final String DEAD_LETTER_SUFFIX = ".DLT";

    private static final List<String> ALL =
            List.of(ACCOUNT_EVENTS, PAYMENT_EVENTS, CATALOG_EVENTS, ORDER_EVENTS, SETTLEMENT_EVENTS);

    private KafkaTopics() {
    }

    public static List<String> all() {
        return ALL;
    }

    public static List<String> deadLetterTopics() {
        return ALL.stream().map(topic -> topic + DEAD_LETTER_SUFFIX).toList();
    }

    public static String deadLetterFor(String topic) {
        return topic + DEAD_LETTER_SUFFIX;
    }

    // ------------------------------------------------------------------ event types

    public static final class Events {

        public static final String ACCOUNT_CREATED = "account.created";
        public static final String ACCOUNT_BALANCE_CHANGED = "account.balance.changed";
        public static final String ACCOUNT_HOLD_PLACED = "account.hold.placed";
        public static final String ACCOUNT_HOLD_RELEASED = "account.hold.released";
        public static final String ACCOUNT_HOLD_CAPTURED = "account.hold.captured";

        public static final String PAYMENT_INITIATED = "payment.initiated";
        public static final String PAYMENT_COMPLETED = "payment.completed";
        public static final String PAYMENT_FAILED = "payment.failed";
        public static final String PAYMENT_REVERSED = "payment.reversed";

        /** A settlement was computed and now owes the merchant money. */
        public static final String SETTLEMENT_CREATED = "settlement.created";
        /** The merchant was actually paid. */
        public static final String SETTLEMENT_PAID = "settlement.paid";
        /** The payout failed and will be retried; the debt stays on the books. */
        public static final String SETTLEMENT_FAILED = "settlement.failed";

        public static final String PRODUCT_PUBLISHED = "product.published";
        public static final String STOCK_RESERVED = "stock.reserved";
        public static final String STOCK_RELEASED = "stock.released";
        public static final String STOCK_COMMITTED = "stock.committed";

        public static final String ORDER_CREATED = "order.created";
        public static final String ORDER_PAID = "order.paid";
        public static final String ORDER_CANCELLED = "order.cancelled";

        private Events() {
        }
    }
}
