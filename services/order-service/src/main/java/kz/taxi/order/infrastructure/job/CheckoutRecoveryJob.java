package kz.taxi.order.infrastructure.job;

import kz.taxi.order.application.CheckoutSagaService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The clock of the checkout saga: it finishes what the request thread could not.
 *
 * <p>An order that is still PENDING_PAYMENT after the saga timeout is either a
 * payment whose outcome nobody learned, a checkout that died before the charge, or a
 * payment service that is down. Two more passes clean up the debts a cancellation
 * left behind (a stock hold that could not be released, a stock commit that failed).
 *
 * <p>The decision rules live in {@link CheckoutSagaService#recoverStuckCheckouts()};
 * this class only owns the schedule, so that everything worth testing can be tested
 * without a scheduler. Scheduling itself is enabled by the platform (the outbox relay
 * needs it too), so no {@code @EnableScheduling} here.
 */
@Component
@Slf4j
public class CheckoutRecoveryJob {

    private final CheckoutSagaService checkoutSaga;

    public CheckoutRecoveryJob(CheckoutSagaService checkoutSaga) {
        this.checkoutSaga = checkoutSaga;
    }

    @Scheduled(fixedDelayString = "${taxi.orders.recovery-interval-ms:60000}",
            initialDelayString = "${taxi.orders.recovery-initial-delay-ms:20000}")
    public void recover() {
        try {
            int resolved = checkoutSaga.recoverStuckCheckouts();
            int released = checkoutSaga.retryPendingCompensations();
            int committed = checkoutSaga.retryPendingStockCommits();
            if (resolved + released + committed > 0) {
                log.info("checkout recovery: {} pending orders resolved, {} stock holds released, {} commits retried",
                        resolved, released, committed);
            }
        } catch (RuntimeException failure) {
            // A failing cleanup must never kill the scheduler thread silently.
            log.error("checkout recovery job failed", failure);
        }
    }
}
