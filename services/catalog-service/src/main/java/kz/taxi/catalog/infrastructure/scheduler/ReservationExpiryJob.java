package kz.taxi.catalog.infrastructure.scheduler;

import kz.taxi.catalog.application.StockReservationService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Returns stock held by checkouts that never paid.
 *
 * <p>Without this job a reservation model leaks inventory: a buyer who opens
 * checkout, holds the last unit and walks away would keep it unsellable forever.
 * The expiry job is what makes "reserved" a temporary promise rather than a
 * permanent claim.
 *
 * <p>The job is a thin shell around one transactional use case on purpose — the
 * stock movement belongs to {@link StockReservationService#expireOverdue()}, so it
 * can be tested (and invoked) without a scheduler.
 */
@Component
@Slf4j
public class ReservationExpiryJob {

    private final StockReservationService reservations;

    public ReservationExpiryJob(StockReservationService reservations) {
        this.reservations = reservations;
    }

    /**
     * Delays are plain milliseconds on purpose: {@code fixedDelayString} accepts a
     * duration string but {@code initialDelayString} does not, and a job that only
     * starts because of a lucky property format is not worth the elegance.
     */
    @Scheduled(fixedDelayString = "${taxi.catalog.expiry-scan-interval-ms:60000}",
            initialDelayString = "${taxi.catalog.expiry-initial-delay-ms:30000}")
    public void expireOverdueReservations() {
        int expired = reservations.expireOverdue();
        if (expired > 0) {
            log.info("expired {} overdue stock reservation(s) and returned their stock to sale", expired);
        } else {
            log.debug("no overdue stock reservations");
        }
    }
}
