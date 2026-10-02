package kz.taxi.payment.infrastructure;

import kz.taxi.payment.application.SettlementService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Turns sales into payouts.
 *
 * <p>Two passes, and the difference matters: the first computes debts from sales
 * that have aged past the hold period, the second retries everything still owed —
 * including payouts that failed earlier and settlements that had nowhere to go
 * until the merchant configured an account.
 *
 * <p>Scheduling itself is enabled by the platform (the outbox relay needs it too),
 * and the delays are plain milliseconds: {@code initialDelayString} does not accept
 * durations like {@code "30s"} in Spring Boot 3.3, it throws at startup. Both facts
 * were learned the hard way on this project, so they live in a comment here rather
 * than in someone's memory.
 */
@Component
@Slf4j
public class MerchantSettlementJob {

    private final SettlementService settlementService;
    private final SettlementProperties properties;

    public MerchantSettlementJob(SettlementService settlementService, SettlementProperties properties) {
        this.settlementService = settlementService;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${taxi.settlement.run-interval-ms:60000}",
            initialDelayString = "${taxi.settlement.initial-delay-ms:30000}")
    public void run() {
        if (!properties.enabled()) {
            return;
        }
        try {
            settlementService.runOnce();
            settlementService.retryPayable();
        } catch (RuntimeException failure) {
            // A failed run must never kill the scheduler thread silently: the next
            // tick retries, and the log says why.
            log.error("settlement job failed", failure);
        }
    }
}
