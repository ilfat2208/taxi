package kz.taxi.account.application;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.HoldStatus;
import kz.taxi.account.domain.LedgerDirection;
import kz.taxi.account.domain.LedgerEntry;
import kz.taxi.account.domain.LedgerOperation;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountLimitRepository;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.account.infrastructure.LedgerEntryRepository;
import kz.taxi.account.infrastructure.LimitUsageRepository;
import kz.taxi.account.support.InMemoryLimitUsage;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The saga-facing behaviour of the money API.
 *
 * <p>Every test here answers the same question: what happens when a caller that
 * already moved money retries? If the answer is "nothing moves again", the saga is
 * safe; if it is "we moved it twice", this is not a payment system.
 */
class InternalAccountApplicationServiceTest {

    private AccountRepository accountRepository;
    private AccountHoldRepository accountHoldRepository;
    private LedgerEntryRepository ledgerEntryRepository;
    private LedgerPostingService ledgerPostingService;
    private OutboxWriter outboxWriter;
    private AccountLimitGuard limitGuard;
    private InternalAccountApplicationService service;

    @BeforeEach
    void setUp() {
        accountRepository = mock(AccountRepository.class);
        accountHoldRepository = mock(AccountHoldRepository.class);
        ledgerEntryRepository = mock(LedgerEntryRepository.class);
        ledgerPostingService = mock(LedgerPostingService.class);
        outboxWriter = mock(OutboxWriter.class);
        // The real guard over mocked repositories: these tests are about the hold
        // lifecycle, and with no configured limit and no recent holds it enforces
        // nothing — exactly the "no limit configured means unlimited" default.
        // Usage accounting is wired to an in-memory store so the placement path is
        // exercised as it runs in production rather than against a null-returning mock.
        LimitUsageRepository limitUsageRepository = mock(LimitUsageRepository.class);
        InMemoryLimitUsage.attachedTo(limitUsageRepository);
        limitGuard = new AccountLimitGuard(mock(AccountLimitRepository.class), limitUsageRepository,
                accountHoldRepository, new AccountLimitMetrics(new SimpleMeterRegistry()), 10, Duration.ofMinutes(5));
        service = new InternalAccountApplicationService(accountRepository, accountHoldRepository,
                ledgerEntryRepository, ledgerPostingService, outboxWriter, limitGuard, Clock.systemUTC(),
                Duration.ofMinutes(15));
    }

    private Account account(long balanceMinor) {
        Account account = Account.open("U-1", "+77001234567", "Aisha", AccountType.CUSTOMER, Currency.KZT);
        if (balanceMinor > 0) {
            account.credit(balanceMinor, Currency.KZT);
        }
        return account;
    }

    private AccountHold activeHold(String id, long amountMinor) {
        return AccountHold.place("A-1", amountMinor, Currency.KZT, "PAYMENT", "P-1", "key-" + id,
                "test", Instant.now().plusSeconds(600));
    }

    // ------------------------------------------------------------------ holds

    @Test
    @DisplayName("places a hold and reports the new available balance")
    void places_hold() {
        Account account = account(100_000);
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(account));
        when(accountHoldRepository.findByIdempotencyKey("key-1")).thenReturn(Optional.empty());
        when(accountHoldRepository.save(any(AccountHold.class))).thenAnswer(call -> call.getArgument(0));

        var result = service.placeHold("A-1", 30_000, Currency.KZT, "PAYMENT", "P-1", "key-1", "lunch");

        assertThat(result.replayed()).isFalse();
        assertThat(result.hold().getAmountMinor()).isEqualTo(30_000);
        assertThat(result.hold().getStatus()).isEqualTo(HoldStatus.ACTIVE);
        assertThat(account.getHeldMinor()).isEqualTo(30_000);
        assertThat(account.availableMinor()).isEqualTo(70_000);
        verify(outboxWriter, times(2)).append(anyString(), anyString(), anyString(), anyString(), anyLong(), any());
    }

    @Test
    @DisplayName("an identical retry replays the hold instead of reserving twice")
    void replayed_hold_does_not_reserve_again() {
        Account account = account(100_000);
        AccountHold existing = AccountHold.place("A-1", 30_000, Currency.KZT, "PAYMENT", "P-1", "key-1",
                "lunch", Instant.now().plusSeconds(600));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(account));
        when(accountHoldRepository.findByIdempotencyKey("key-1")).thenReturn(Optional.of(existing));

        var result = service.placeHold("A-1", 30_000, Currency.KZT, "PAYMENT", "P-1", "key-1", "lunch");

        assertThat(result.replayed()).isTrue();
        assertThat(result.hold()).isSameAs(existing);
        assertThat(account.getHeldMinor()).isZero();
        verify(accountHoldRepository, never()).save(any());
    }

    @Test
    @DisplayName("the same key with a different amount is a client bug, not a second payment")
    void reusing_key_with_different_amount_is_rejected() {
        Account account = account(100_000);
        AccountHold existing = AccountHold.place("A-1", 30_000, Currency.KZT, "PAYMENT", "P-1", "key-1",
                "lunch", Instant.now().plusSeconds(600));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(account));
        when(accountHoldRepository.findByIdempotencyKey("key-1")).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> service.placeHold("A-1", 999_999, Currency.KZT, "PAYMENT", "P-1", "key-1", "lunch"))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(CommonErrorCode.IDEMPOTENCY_CONFLICT);
    }

    @Test
    @DisplayName("a hold cannot exceed available funds")
    void rejects_hold_beyond_available() {
        Account account = account(10_000);
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(account));
        when(accountHoldRepository.findByIdempotencyKey(anyString())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.placeHold("A-1", 20_000, Currency.KZT, "PAYMENT", "P-1", "key-9", null))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.INSUFFICIENT_FUNDS);

        assertThat(account.getHeldMinor()).isZero();
    }

    // ------------------------------------------------------------------ capture

    @Test
    @DisplayName("capture moves the reserved money and posts a balanced transaction")
    void capture_moves_money() {
        Account source = account(100_000);
        source.reserve(30_000, Currency.KZT);
        Account target = account(0);
        AccountHold hold = activeHold("H-1", 30_000);

        when(accountHoldRepository.findByIdForUpdate(hold.getId())).thenReturn(Optional.of(hold));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(source));
        when(accountRepository.findByIdForUpdate("A-2")).thenReturn(Optional.of(target));
        when(ledgerPostingService.post(eq(source), eq(target), eq(30_000L), eq(LedgerOperation.P2P_TRANSFER),
                eq(InternalAccountApplicationService.REFERENCE_HOLD), eq(hold.getId()), any()))
                .thenReturn("TX-1");

        var result = service.captureHold(hold.getId(), "A-2", LedgerOperation.P2P_TRANSFER, "lunch");

        assertThat(result.replayed()).isFalse();
        assertThat(result.transactionId()).isEqualTo("TX-1");
        assertThat(hold.getStatus()).isEqualTo(HoldStatus.CAPTURED);
        assertThat(source.getBalanceMinor()).isEqualTo(70_000);
        assertThat(source.getHeldMinor()).isZero();
        assertThat(target.getBalanceMinor()).isEqualTo(30_000);
    }

    @Test
    @DisplayName("capturing without a target credits the platform suspense account")
    void capture_without_target_settles_to_suspense() {
        Account source = account(100_000);
        source.reserve(30_000, Currency.KZT);
        Account suspense = Account.openSystemAccount(Currency.KZT);
        AccountHold hold = activeHold("H-2", 30_000);

        when(accountHoldRepository.findByIdForUpdate(hold.getId())).thenReturn(Optional.of(hold));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(source));
        when(ledgerPostingService.suspenseAccount(Currency.KZT)).thenReturn(suspense);
        when(ledgerPostingService.post(eq(source), eq(suspense), eq(30_000L), eq(LedgerOperation.MERCHANT_PAYMENT),
                eq(InternalAccountApplicationService.REFERENCE_HOLD), eq(hold.getId()), any()))
                .thenReturn("TX-2");

        var result = service.captureHold(hold.getId(), null, null, "marketplace order");

        assertThat(result.transactionId()).isEqualTo("TX-2");
        assertThat(source.getBalanceMinor()).isEqualTo(70_000);
        // Regression guard: the destination balance must actually move. Writing the
        // credit entry without applying it would make the account row and the ledger
        // disagree by exactly the captured amount.
        assertThat(suspense.getBalanceMinor()).isEqualTo(30_000);
        verify(ledgerPostingService).post(eq(source), eq(suspense), eq(30_000L),
                eq(LedgerOperation.MERCHANT_PAYMENT), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("replaying a capture returns the original transaction and moves nothing")
    void replayed_capture_is_a_no_op() {
        AccountHold hold = activeHold("H-3", 30_000);
        hold.capture();
        when(accountHoldRepository.findByIdForUpdate(hold.getId())).thenReturn(Optional.of(hold));

        LedgerEntry original = LedgerEntry.debit("TX-ORIGINAL", account(0), 30_000, LedgerOperation.P2P_TRANSFER,
                InternalAccountApplicationService.REFERENCE_HOLD, hold.getId(), null, null);
        when(ledgerEntryRepository.findFirstByReferenceTypeAndReferenceIdAndDirectionOrderByCreatedAtDesc(
                InternalAccountApplicationService.REFERENCE_HOLD, hold.getId(), LedgerDirection.DEBIT))
                .thenReturn(Optional.of(original));

        var result = service.captureHold(hold.getId(), null, null, null);

        assertThat(result.replayed()).isTrue();
        assertThat(result.transactionId()).isEqualTo("TX-ORIGINAL");
        verify(ledgerPostingService, never()).post(any(), any(), anyLong(), any(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("an expired hold cannot be captured: its funds were already returned")
    void expired_hold_cannot_be_captured() {
        Account source = account(100_000);
        AccountHold expired = AccountHold.place("A-1", 30_000, Currency.KZT, "PAYMENT", "P-1", "key-exp", null,
                Instant.now().minusSeconds(5));
        when(accountHoldRepository.findByIdForUpdate(expired.getId())).thenReturn(Optional.of(expired));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(source));

        assertThatThrownBy(() -> service.captureHold(expired.getId(), null, null, null))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.HOLD_EXPIRED);

        assertThat(expired.getStatus()).isEqualTo(HoldStatus.EXPIRED);
        assertThat(source.getBalanceMinor()).isEqualTo(100_000);
        verify(ledgerPostingService, never()).post(any(), any(), anyLong(), any(), anyString(), anyString(), any());
    }

    // ------------------------------------------------------------------ release

    @Test
    @DisplayName("release returns the funds and is safe to repeat")
    void release_is_idempotent() {
        Account source = account(100_000);
        source.reserve(30_000, Currency.KZT);
        AccountHold hold = activeHold("H-5", 30_000);

        when(accountHoldRepository.findByIdForUpdate(hold.getId())).thenReturn(Optional.of(hold));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(source));

        service.releaseHold(hold.getId(), "payment failed");
        assertThat(source.availableMinor()).isEqualTo(100_000);

        AccountHold again = service.releaseHold(hold.getId(), "retry of the same release");

        assertThat(again.getStatus()).isEqualTo(HoldStatus.RELEASED);
        assertThat(source.availableMinor()).isEqualTo(100_000);
        verify(accountRepository, times(1)).findByIdForUpdate("A-1");
    }

    @Test
    @DisplayName("a captured hold cannot be released: that would invent money")
    void captured_hold_cannot_be_released() {
        AccountHold hold = activeHold("H-6", 30_000);
        hold.capture();
        when(accountHoldRepository.findByIdForUpdate(hold.getId())).thenReturn(Optional.of(hold));

        assertThatThrownBy(() -> service.releaseHold(hold.getId(), "oops"))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.HOLD_NOT_ACTIVE);
    }

    // ------------------------------------------------------------------ credits

    @Test
    @DisplayName("a credit is posted once per business reference")
    void credit_is_idempotent_by_reference() {
        Account target = account(0);
        when(ledgerEntryRepository.existsByReferenceTypeAndReferenceId("PAYMENT", "P-9")).thenReturn(true);
        LedgerEntry original = LedgerEntry.credit("TX-9", account(0), 5_000, LedgerOperation.REFUND,
                "PAYMENT", "P-9", null, null);
        when(ledgerEntryRepository.findFirstByReferenceTypeAndReferenceIdAndDirectionOrderByCreatedAtDesc(
                "PAYMENT", "P-9", LedgerDirection.CREDIT)).thenReturn(Optional.of(original));
        when(accountRepository.findById("A-1")).thenReturn(Optional.of(target));

        var result = service.credit("A-1", 5_000, Currency.KZT, "PAYMENT", "P-9", LedgerOperation.REFUND, "refund");

        assertThat(result.replayed()).isTrue();
        assertThat(result.transactionId()).isEqualTo("TX-9");
        assertThat(target.getBalanceMinor()).isZero();
        verify(ledgerPostingService, never()).post(any(), any(), anyLong(), any(), anyString(), anyString(), any());
    }

    @Test
    @DisplayName("a fresh credit debits the suspense account and credits the customer")
    void credit_balances_against_suspense() {
        Account target = account(0);
        Account suspense = Account.openSystemAccount(Currency.KZT);
        when(ledgerEntryRepository.existsByReferenceTypeAndReferenceId("REFUND", "R-1")).thenReturn(false);
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(target));
        when(ledgerPostingService.suspenseAccount(Currency.KZT)).thenReturn(suspense);
        when(ledgerPostingService.post(eq(suspense), eq(target), eq(5_000L), eq(LedgerOperation.REFUND),
                eq("REFUND"), eq("R-1"), any())).thenReturn("TX-10");

        var result = service.credit("A-1", 5_000, Currency.KZT, "REFUND", "R-1", LedgerOperation.REFUND, "refund");

        assertThat(result.transactionId()).isEqualTo("TX-10");
        assertThat(target.getBalanceMinor()).isEqualTo(5_000);
        assertThat(suspense.getBalanceMinor()).isEqualTo(-5_000);
    }

    @Test
    @DisplayName("crediting another currency is rejected")
    void credit_rejects_currency_mismatch() {
        Account target = account(0);
        when(ledgerEntryRepository.existsByReferenceTypeAndReferenceId(anyString(), anyString())).thenReturn(false);
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(target));

        assertThatThrownBy(() -> service.credit("A-1", 5_000, Currency.USD, "REFUND", "R-2", null, null))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.CURRENCY_MISMATCH);
    }

    // ------------------------------------------------------------------ expiry

    @Test
    @DisplayName("the expiry job returns funds nobody came back for")
    void expires_stale_holds() {
        Account source = account(100_000);
        source.reserve(40_000, Currency.KZT);
        AccountHold stale = AccountHold.place("A-1", 40_000, Currency.KZT, "PAYMENT", "P-1", "key-7", null,
                Instant.now().minusSeconds(60));

        when(accountHoldRepository.findByStatusAndExpiresAtBefore(eq(HoldStatus.ACTIVE), any(Instant.class), any()))
                .thenReturn(List.of(stale));
        when(accountHoldRepository.findByIdForUpdate(stale.getId())).thenReturn(Optional.of(stale));
        when(accountRepository.findByIdForUpdate("A-1")).thenReturn(Optional.of(source));

        int expired = service.expireDueHolds(100);

        assertThat(expired).isEqualTo(1);
        assertThat(stale.getStatus()).isEqualTo(HoldStatus.EXPIRED);
        assertThat(source.availableMinor()).isEqualTo(100_000);

        ArgumentCaptor<String> eventType = ArgumentCaptor.forClass(String.class);
        verify(outboxWriter, times(2)).append(anyString(), eventType.capture(), anyString(), anyString(), anyLong(), any());
        assertThat(eventType.getAllValues()).contains("account.hold.released");
    }
}
