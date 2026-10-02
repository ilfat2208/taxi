package kz.taxi.payment.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Settlement policy.
 *
 * @param enabled        turns the scheduler off (an operator can still run it by hand)
 * @param holdPeriod     how long a sale is held before it may be paid out. A real
 *                       marketplace uses T+1 or longer so a refund can still be
 *                       absorbed; the demo default is short so the flow is visible
 * @param autoPayout     whether a computed settlement is paid immediately. When
 *                       {@code false} the debt is recorded and an operator releases
 *                       it — which is how most marketplaces actually operate
 * @param runIntervalMs  how often the job looks for work
 * @param initialDelayMs delay before the first run, so a rolling deploy does not
 *                       have every replica settle at the same instant
 * @param batchSize      how many merchant+currency groups one run handles
 */
@ConfigurationProperties(prefix = "taxi.settlement")
public record SettlementProperties(
        boolean enabled,
        Duration holdPeriod,
        boolean autoPayout,
        long runIntervalMs,
        long initialDelayMs,
        int batchSize
) {

    public SettlementProperties {
        holdPeriod = holdPeriod == null ? Duration.ofHours(1) : holdPeriod;
        runIntervalMs = runIntervalMs <= 0 ? 60_000 : runIntervalMs;
        initialDelayMs = initialDelayMs <= 0 ? 30_000 : initialDelayMs;
        batchSize = batchSize <= 0 ? 50 : batchSize;
    }
}
