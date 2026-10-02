package kz.taxi.payment.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The arithmetic of a marketplace payout.
 *
 * <p>These are the numbers a merchant will check against its own sales, so they are
 * tested as rules rather than as a happy path: the commission belongs to the
 * platform, the goods value belongs to the merchant, and the two must always add up
 * to what the customer actually paid.
 */
class MerchantSettlementTest {

    private static final Instant PERIOD_END = Instant.parse("2024-09-02T00:00:00Z");

    private MerchantSettlement settlement(long gross, long commission, int payments) {
        return MerchantSettlement.of("M-1", "U-1", "ACC-1", Currency.KZT,
                PERIOD_END.minus(1, ChronoUnit.DAYS), PERIOD_END,
                new MerchantSettlement.PeriodTotals(payments, gross, commission, gross + commission));
    }

    @Test
    @DisplayName("the merchant is owed the goods value, the platform keeps the commission")
    void splits_goods_and_commission() {
        // Two sales of 2 900.00 KZT with a 1.5% fee each: 43.50 KZT commission in total.
        MerchantSettlement settlement = settlement(290_000, 4_350, 2);

        assertThat(settlement.getNetMinor()).isEqualTo(290_000);
        assertThat(settlement.getCommissionMinor()).isEqualTo(4_350);
        assertThat(settlement.getCustomerPaidMinor()).isEqualTo(294_350);
        assertThat(settlement.net().toString()).isEqualTo("2900.00 KZT");
        assertThat(settlement.getStatus()).isEqualTo(SettlementStatus.PENDING);
        assertThat(settlement.getSettlementNumber()).startsWith("SET-240902-");
        assertThat(settlement.describe()).contains("2900.00 KZT net").contains("43.50 KZT commission");
    }

    @Test
    @DisplayName("a settlement that does not add up cannot be constructed")
    void rejects_inconsistent_totals() {
        assertThatThrownBy(() -> new MerchantSettlement.PeriodTotals(2, 290_000, 4_350, 1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("plus commission");

        assertThatThrownBy(() -> new MerchantSettlement.PeriodTotals(0, 0, 0, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("at least one payment");

        assertThatThrownBy(() -> new MerchantSettlement.PeriodTotals(1, -1, 0, -1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("cannot be negative");
    }

    @Test
    @DisplayName("the idempotency key depends on the period, so the same period cannot be settled twice")
    void derives_stable_idempotency_key() {
        String first = MerchantSettlement.idempotencyKey("M-1", Currency.KZT, PERIOD_END);
        String second = MerchantSettlement.idempotencyKey("M-1", Currency.KZT, PERIOD_END);

        assertThat(first).isEqualTo(second).contains("M-1").contains("KZT");
        assertThat(MerchantSettlement.idempotencyKey("M-2", Currency.KZT, PERIOD_END)).isNotEqualTo(first);
        assertThat(MerchantSettlement.idempotencyKey("M-1", Currency.USD, PERIOD_END)).isNotEqualTo(first);
        assertThat(MerchantSettlement.idempotencyKey("M-1", Currency.KZT, PERIOD_END.plusSeconds(1)))
                .isNotEqualTo(first);
    }

    @Test
    @DisplayName("paying is idempotent and recorded once")
    void marks_paid_once() {
        MerchantSettlement settlement = settlement(100_000, 1_500, 1);

        settlement.markPaid(PERIOD_END);
        Instant firstPaidAt = settlement.getPaidAt();
        settlement.markPaid(PERIOD_END.plusSeconds(600));

        assertThat(settlement.getStatus()).isEqualTo(SettlementStatus.PAID);
        assertThat(settlement.getPaidAt()).isEqualTo(firstPaidAt);
        assertThat(settlement.isPayable()).isFalse();
    }

    @Test
    @DisplayName("a failed payout keeps the debt on the books")
    void failure_stays_payable() {
        MerchantSettlement settlement = settlement(100_000, 1_500, 1);

        settlement.markFailed("account service is unavailable");

        assertThat(settlement.getStatus()).isEqualTo(SettlementStatus.FAILED);
        assertThat(settlement.isPayable()).isTrue();
        assertThat(settlement.getFailureReason()).contains("unavailable");

        settlement.markPaid(PERIOD_END);
        assertThat(settlement.getStatus()).isEqualTo(SettlementStatus.PAID);
        assertThat(settlement.getFailureReason()).isNull();
    }

    @Test
    @DisplayName("a paid settlement cannot be redirected to another account")
    void cannot_redirect_paid_settlement() {
        MerchantSettlement settlement = settlement(100_000, 1_500, 1);
        settlement.assignPayoutAccount("ACC-2");
        assertThat(settlement.getPayoutAccountId()).isEqualTo("ACC-2");

        settlement.markPaid(PERIOD_END);

        assertThatThrownBy(() -> settlement.assignPayoutAccount("ACC-3"))
                .isInstanceOf(DomainException.class)
                .hasMessageContaining("already paid");
        assertThat(settlement.getPayoutAccountId()).isEqualTo("ACC-2");
    }

    @Test
    @DisplayName("a settlement without a payout account is not payable yet, but is not an error")
    void knows_when_it_cannot_be_paid() {
        MerchantSettlement withoutAccount = MerchantSettlement.of("M-1", "U-1", null, Currency.KZT,
                PERIOD_END.minus(1, ChronoUnit.DAYS), PERIOD_END,
                new MerchantSettlement.PeriodTotals(1, 1_000, 15, 1_015));

        assertThat(withoutAccount.hasPayoutAccount()).isFalse();
        assertThat(withoutAccount.isPayable()).isTrue();
        assertThat(settlement(1_000, 15, 1).hasPayoutAccount()).isTrue();
    }
}
