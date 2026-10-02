package kz.taxi.common.core.outbox;

/** Lifecycle state of a row in an {@code outbox_message} table. */
public enum OutboxStatus {

    /** Written in the same transaction as the aggregate change, not yet published. */
    PENDING,

    /** Successfully produced to Kafka. */
    PUBLISHED,

    /** Publication failed; retried with backoff until {@code attempts} hits the cap. */
    FAILED
}
