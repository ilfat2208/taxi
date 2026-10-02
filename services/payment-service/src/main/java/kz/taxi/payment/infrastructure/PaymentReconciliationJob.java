package kz.taxi.payment.infrastructure;

import kz.taxi.payment.application.PaymentReconciliationService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the consistency checks periodically.
 *
 * <p>Off by default in nothing, but harmless when it finds nothing (it is read-only):
 * a reconciliation pass that only runs when someone suspects a problem is a
 * reconciliation pass that never runs. Delays are plain milliseconds — Spring Boot
 * 3.3 rejects duration strings in {@code initialDelayString}.
 */
@Component
public class PaymentReconciliationJob {

    private final PaymentReconciliationService reconciliation;
    private final int batchSize;

    public PaymentReconciliationJob(PaymentReconciliationService reconciliation,
                                    @Value("${taxi.reconciliation.batch-size:500}") int batchSize) {
        this.reconciliation = reconciliation;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${taxi.reconciliation.interval-ms:900000}",
            initialDelayString = "${taxi.reconciliation.initial-delay-ms:120000}")
    public void run() {
        reconciliation.runOnce(batchSize);
    }
}
