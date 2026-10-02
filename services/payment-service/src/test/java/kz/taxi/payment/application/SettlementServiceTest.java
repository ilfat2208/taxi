package kz.taxi.payment.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.SettlementStatus;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.CatalogMerchantClient;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.SettlementProperties;
import kz.taxi.payment.infrastructure.SettlementRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Pageable;

import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Settlement orchestration: who gets paid, who does not, and why.
 *
 * <p>The interesting cases are the unhappy ones. A payout that moves money for a
 * merchant with no account, or that disappears because one catalog call timed out,
 * is worse than a payout that simply does not happen yet.
 */
class SettlementServiceTest {

    private static final Instant PERIOD_END = Instant.parse("2024-09-02T00:00:00Z");

    private PaymentRepository payments;
    private SettlementRepository settlements;
    private SettlementStateService state;
    private CatalogMerchantClient merchants;
    private AccountServiceClient accounts;
    private SettlementService service;

    @BeforeEach
    void setUp() {
        payments = mock(PaymentRepository.class);
        settlements = mock(SettlementRepository.class);
        state = mock(SettlementStateService.class);
        merchants = mock(CatalogMerchantClient.class);
        accounts = mock(AccountServiceClient.class);
        SettlementProperties properties =
                new SettlementProperties(true, Duration.ofHours(1), true, 60_000, 30_000, 50);
        service = new SettlementService(payments, settlements, state, merchants, accounts, properties);
    }

    private MerchantSettlement payableSettlement(String payoutAccountId) {
        return MerchantSettlement.of("M-1", "U-1", payoutAccountId, Currency.KZT,
                PERIOD_END.minus(1, ChronoUnit.DAYS), PERIOD_END,
                new MerchantSettlement.PeriodTotals(2, 290_000, 4_350, 294_350));
    }

    private void givenCandidate(String merchantId) {
        when(payments.findMerchantsWithUnsettledSales(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of(new SettlementCandidate(merchantId, Currency.KZT)));
    }

    @Test
    @DisplayName("computes the debt and pays it through the ledger")
    void computes_and_pays() {
        givenCandidate("M-1");
        MerchantSettlement settlement = payableSettlement("ACC-1");
        when(merchants.merchant("M-1"))
                .thenReturn(new CatalogMerchantClient.MerchantSnapshot("M-1", "U-1", "Shop", "ACC-1"));
        when(state.createSettlement(eq("M-1"), eq(Currency.KZT), any(Instant.class), eq("U-1"), eq("ACC-1")))
                .thenReturn(Optional.of(settlement));
        when(accounts.credit(any(AccountServiceClient.CreditRequest.class)))
                .thenReturn(new AccountServiceClient.CreditResult("ACC-1", "TX-1", 290_000, "KZT", 290_000, false));
        MerchantSettlement paid = payableSettlement("ACC-1");
        paid.markPaid(PERIOD_END);
        when(state.markPaid(settlement.getId(), "TX-1")).thenReturn(paid);

        SettlementService.RunSummary summary = service.runOnce();

        assertThat(summary.computed()).isEqualTo(1);
        assertThat(summary.paid()).isEqualTo(1);
        assertThat(summary.failed()).isZero();

        ArgumentCaptor<AccountServiceClient.CreditRequest> credit =
                ArgumentCaptor.forClass(AccountServiceClient.CreditRequest.class);
        verify(accounts).credit(credit.capture());
        assertThat(credit.getValue().accountId()).isEqualTo("ACC-1");
        assertThat(credit.getValue().amountMinor()).isEqualTo(290_000);
        // The settlement id is the ledger reference: that is what makes a retried
        // payout land on the existing transaction instead of paying twice.
        assertThat(credit.getValue().referenceType()).isEqualTo(SettlementService.REFERENCE_SETTLEMENT);
        assertThat(credit.getValue().referenceId()).isEqualTo(settlement.getId());
        verify(state).markPaid(settlement.getId(), "TX-1");
    }

    @Test
    @DisplayName("a merchant without a payout account keeps the debt, and nobody is paid")
    void keeps_debt_when_no_payout_account() {
        givenCandidate("M-1");
        MerchantSettlement settlement = payableSettlement(null);
        when(merchants.merchant("M-1"))
                .thenReturn(new CatalogMerchantClient.MerchantSnapshot("M-1", "U-1", "Shop", null));
        when(state.createSettlement(anyString(), any(Currency.class), any(Instant.class), anyString(), eq(null)))
                .thenReturn(Optional.of(settlement));

        SettlementService.RunSummary summary = service.runOnce();

        assertThat(summary.computed()).isEqualTo(1);
        assertThat(summary.awaitingPayoutAccount()).isEqualTo(1);
        assertThat(summary.paid()).isZero();
        verify(accounts, never()).credit(any());
        verify(state, never()).markFailed(anyString(), anyString());
        assertThat(settlement.getStatus()).isEqualTo(SettlementStatus.PENDING);
    }

    @Test
    @DisplayName("a failed payout is recorded as failed, never as paid")
    void records_failed_payout() {
        givenCandidate("M-1");
        MerchantSettlement settlement = payableSettlement("ACC-1");
        when(merchants.merchant("M-1"))
                .thenReturn(new CatalogMerchantClient.MerchantSnapshot("M-1", "U-1", "Shop", "ACC-1"));
        when(state.createSettlement(anyString(), any(Currency.class), any(Instant.class), anyString(), anyString()))
                .thenReturn(Optional.of(settlement));
        when(accounts.credit(any(AccountServiceClient.CreditRequest.class)))
                .thenThrow(DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE, "account service is down"));
        MerchantSettlement failed = payableSettlement("ACC-1");
        failed.markFailed("account service is down");
        when(state.markFailed(eq(settlement.getId()), anyString())).thenReturn(failed);

        SettlementService.RunSummary summary = service.runOnce();

        assertThat(summary.failed()).isEqualTo(1);
        assertThat(summary.paid()).isZero();
        verify(state).markFailed(eq(settlement.getId()), anyString());
        verify(state, never()).markPaid(anyString(), anyString());
    }

    @Test
    @DisplayName("one unknown merchant does not stop the others from being paid")
    void isolates_merchant_failures() {
        when(payments.findMerchantsWithUnsettledSales(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of(new SettlementCandidate("M-GONE", Currency.KZT),
                        new SettlementCandidate("M-OK", Currency.KZT)));
        when(merchants.merchant("M-GONE"))
                .thenThrow(DomainException.of(PaymentErrorCode.MERCHANT_NOT_FOUND, "merchant M-GONE is gone"));
        MerchantSettlement settlement = payableSettlement("ACC-2");
        when(merchants.merchant("M-OK"))
                .thenReturn(new CatalogMerchantClient.MerchantSnapshot("M-OK", "U-2", "Shop", "ACC-2"));
        when(state.createSettlement(eq("M-OK"), any(Currency.class), any(Instant.class), eq("U-2"), eq("ACC-2")))
                .thenReturn(Optional.of(settlement));
        when(accounts.credit(any(AccountServiceClient.CreditRequest.class)))
                .thenReturn(new AccountServiceClient.CreditResult("ACC-2", "TX-2", 290_000, "KZT", 290_000, false));
        MerchantSettlement paid = payableSettlement("ACC-2");
        paid.markPaid(PERIOD_END);
        when(state.markPaid(settlement.getId(), "TX-2")).thenReturn(paid);

        SettlementService.RunSummary summary = service.runOnce();

        assertThat(summary.paid()).isEqualTo(1);
        assertThat(summary.failed()).isEqualTo(1);
        verify(accounts, times(1)).credit(any());
    }

    @Test
    @DisplayName("nothing to settle means no calls at all")
    void does_nothing_when_there_is_nothing_to_do() {
        when(payments.findMerchantsWithUnsettledSales(any(Instant.class), any(Pageable.class)))
                .thenReturn(List.of());

        SettlementService.RunSummary summary = service.runOnce();

        assertThat(summary.didAnything()).isFalse();
        assertThat(summary.computed()).isZero();
        verify(merchants, never()).merchant(anyString());
        verify(accounts, never()).credit(any());
    }

    @Test
    @DisplayName("a settlement whose sales were already taken by another run is skipped, not duplicated")
    void skips_when_computation_yields_nothing() {
        givenCandidate("M-1");
        when(merchants.merchant("M-1"))
                .thenReturn(new CatalogMerchantClient.MerchantSnapshot("M-1", "U-1", "Shop", "ACC-1"));
        when(state.createSettlement(anyString(), any(Currency.class), any(Instant.class), anyString(), anyString()))
                .thenReturn(Optional.empty());

        SettlementService.RunSummary summary = service.runOnce();

        assertThat(summary.computed()).isZero();
        assertThat(summary.nothingToSettle()).isEqualTo(1);
        verify(accounts, never()).credit(any());
    }

    @Test
    @DisplayName("the retry pass pays what is still owed, including earlier failures")
    void retries_payable_settlements() {
        MerchantSettlement failedEarlier = payableSettlement("ACC-1");
        failedEarlier.markFailed("account service was down");
        // The queue is claimed through the state service: the pessimistic lock that
        // makes it safe for several replicas needs an active transaction, so it cannot
        // live in the orchestrator.
        when(state.claimPayable(anyInt())).thenReturn(List.of(failedEarlier));
        when(accounts.credit(any(AccountServiceClient.CreditRequest.class)))
                .thenReturn(new AccountServiceClient.CreditResult("ACC-1", "TX-9", 290_000, "KZT", 290_000, false));
        MerchantSettlement paid = payableSettlement("ACC-1");
        paid.markPaid(PERIOD_END);
        when(state.markPaid(failedEarlier.getId(), "TX-9")).thenReturn(paid);

        SettlementService.RunSummary summary = service.retryPayable();

        assertThat(summary.paid()).isEqualTo(1);
        verify(payments, never()).findMerchantsWithUnsettledSales(any(Instant.class), any(Pageable.class));
    }
}
