package kz.taxi.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One payment covered by one settlement.
 *
 * <p>This is the table that answers the only question a merchant ever asks about a
 * payout — "what exactly am I being paid for?" — without re-deriving the period from
 * timestamps. Re-derivation is tempting and wrong: a refund, a late payment or a
 * retried job all change what a naive query would return, and the settlement has
 * already been paid.
 *
 * <p>{@code paymentId} is the primary key, so a payment belongs to at most one
 * settlement. That is the database refusing to pay for the same sale twice, even if
 * two settlement jobs run at the same moment.
 */
@Entity
@Table(name = "settlement_payment")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SettlementPayment {

    @Id
    @Column(name = "payment_id", length = 26, nullable = false, updatable = false)
    private String paymentId;

    @Column(name = "settlement_id", length = 26, nullable = false, updatable = false)
    private String settlementId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public static SettlementPayment of(String settlementId, String paymentId) {
        SettlementPayment line = new SettlementPayment();
        line.paymentId = paymentId;
        line.settlementId = settlementId;
        line.createdAt = Instant.now();
        return line;
    }
}
