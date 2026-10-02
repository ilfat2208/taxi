package kz.taxi.account.infrastructure;

import kz.taxi.account.application.InternalAccountApplicationService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Returns funds reserved by payments nobody ever finished.
 *
 * <p>Scheduling is enabled by the platform (the outbox relay needs it too), so a
 * service does not have to remember {@code @EnableScheduling}. The job is
 * deliberately dumb and small: all the reasoning lives in the application service,
 * where it can be unit-tested without a scheduler.
 */
@Component
@Slf4j
public class HoldExpiryJob {

    private final InternalAccountApplicationService internalAccounts;
    private final int batchSize;

    public HoldExpiryJob(InternalAccountApplicationService internalAccounts,
                         @Value("${taxi.account.hold-expiry-batch-size:100}") int batchSize) {
        this.internalAccounts = internalAccounts;
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${taxi.account.hold-expiry-interval-ms:60000}",
            initialDelayString = "${taxi.account.hold-expiry-initial-delay-ms:15000}")
    public void releaseExpiredHolds() {
        try {
            int expired = internalAccounts.expireDueHolds(batchSize);
            if (expired > 0) {
                log.info("hold expiry job released {} reserved payments", expired);
            }
        } catch (RuntimeException failure) {
            // A failing cleanup must never kill the scheduler thread silently.
            log.error("hold expiry job failed", failure);
        }
    }
}
