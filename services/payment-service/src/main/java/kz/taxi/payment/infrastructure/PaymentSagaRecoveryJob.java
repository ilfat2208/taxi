package kz.taxi.payment.infrastructure;

import kz.taxi.payment.application.PaymentRecoveryService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Resolves payments nobody is driving any more.
 *
 * <p>Scheduling is already enabled by the platform (the outbox relay needs it), so
 * this job only has to declare when it runs. The decision table lives in
 * {@link PaymentRecoveryService} — a job that reason about money is a job nobody
 * can test, so this class does nothing but call it and survive.
 *
 * <p>The first run is delayed on purpose: a service that has just restarted is
 * usually restarting <em>because</em> something broke, and hammering the account
 * service with a recovery batch during a rolling deploy helps nobody.
 */
@Component
@Slf4j
public class PaymentSagaRecoveryJob {

    private final PaymentRecoveryService recovery;
    private final PaymentProperties properties;

    public PaymentSagaRecoveryJob(PaymentRecoveryService recovery, PaymentProperties properties) {
        this.recovery = recovery;
        this.properties = properties;
    }

    @Scheduled(fixedDelayString = "${taxi.payments.saga.fixed-delay-ms:30000}",
            initialDelayString = "${taxi.payments.saga.initial-delay-ms:30000}")
    public void recoverStuckPayments() {
        try {
            int batchSize = properties.getSaga().getBatchSize();
            int payments = recovery.recoverStuckPayments(batchSize);
            int refunds = recovery.recoverStuckRefunds(batchSize);
            if (payments > 0 || refunds > 0) {
                log.info("saga recovery resolved {} payment(s) and {} refund(s)", payments, refunds);
            }
        } catch (RuntimeException failure) {
            // A failing cleanup must never kill the scheduler thread silently.
            log.error("saga recovery job failed", failure);
        }
    }
}
