package kz.taxi.order.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Checkout tuning knobs.
 *
 * @param deliveryFeeMinor what delivery costs, in minor units; {@code 0} means free
 *                         delivery, which is the default because a surprise fee at
 *                         the payment step is the fastest way to lose a customer
 * @param sagaTimeout      how long an order may stay PENDING_PAYMENT before the
 *                         recovery job takes it over; it must exceed the payment
 *                         service's own worst case, otherwise the job reconciles
 *                         payments that are still being made
 * @param recoveryBatchSize how many orders one recovery pass looks at, so a backlog
 *                          cannot be loaded into memory in one go
 */
@ConfigurationProperties(prefix = "taxi.orders")
public record OrderProperties(long deliveryFeeMinor, Duration sagaTimeout, int recoveryBatchSize) {

    private static final Duration DEFAULT_SAGA_TIMEOUT = Duration.ofMinutes(5);
    private static final int DEFAULT_RECOVERY_BATCH_SIZE = 50;
    private static final int MAX_RECOVERY_BATCH_SIZE = 500;

    public OrderProperties {
        deliveryFeeMinor = Math.max(deliveryFeeMinor, 0L);
        sagaTimeout = sagaTimeout == null || sagaTimeout.isZero() || sagaTimeout.isNegative()
                ? DEFAULT_SAGA_TIMEOUT
                : sagaTimeout;
        recoveryBatchSize = recoveryBatchSize <= 0
                ? DEFAULT_RECOVERY_BATCH_SIZE
                : Math.min(recoveryBatchSize, MAX_RECOVERY_BATCH_SIZE);
    }
}
