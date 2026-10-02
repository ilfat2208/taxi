package kz.taxi.payment.application;

import java.time.Instant;

/**
 * Payloads published to {@code settlement.events}.
 *
 * <p>Flat and self-contained, like every other event in the platform: accounting, a
 * merchant notification service or an analytics job must be able to react without
 * calling back into payment-service — the call would re-introduce exactly the
 * coupling the topic exists to remove.
 *
 * <p>{@code transactionId} is present only on {@code settlement.paid}: it is the
 * ledger transaction that moved the money, and it is the handle an accountant uses
 * to tie a payout to the books.
 */
public final class SettlementEvents {

    private SettlementEvents() {
    }

    public record SettlementLifecycle(String settlementId,
                                      String settlementNumber,
                                      String merchantId,
                                      String ownerUserId,
                                      String payoutAccountId,
                                      String status,
                                      String currency,
                                      long grossMinor,
                                      long commissionMinor,
                                      long customerPaidMinor,
                                      long netMinor,
                                      int paymentCount,
                                      String transactionId,
                                      String failureReason,
                                      Instant periodStart,
                                      Instant periodEnd,
                                      Instant occurredAt) {
    }
}
