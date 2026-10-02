package kz.taxi.payment.api.dto;

import java.time.Instant;
import java.util.List;

/**
 * Settlement API shapes.
 *
 * <p>{@code paymentIds} is only filled for a single settlement: it is the answer to
 * "what exactly is this payout for?", and a merchant is entitled to it without
 * asking support. Listing payouts deliberately omits it — a page of settlements
 * should not carry a page of payment ids.
 */
public final class SettlementDtos {

    private SettlementDtos() {
    }

    public record SettlementResponse(
            String settlementId,
            String settlementNumber,
            String merchantId,
            String ownerUserId,
            String status,
            String currency,
            long grossMinor,
            long commissionMinor,
            long customerPaidMinor,
            long netMinor,
            int paymentCount,
            String payoutAccountId,
            Instant periodStart,
            Instant periodEnd,
            Instant createdAt,
            Instant paidAt,
            String failureReason) {
    }

    public record SettlementDetailResponse(SettlementResponse settlement, List<String> paymentIds) {
    }

    public record SettlementRunResponse(int computed,
                                        int paid,
                                        int failed,
                                        int awaitingPayoutAccount,
                                        int nothingToSettle) {
    }
}
