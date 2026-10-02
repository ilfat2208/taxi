package kz.taxi.account.application;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.AccountLimit;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.HoldStatus;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountLimitRepository;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.account.infrastructure.LedgerEntryRepository;
import kz.taxi.account.infrastructure.LimitUsageRepository;
import kz.taxi.account.support.InMemoryLimitUsage;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Limits seen from the outside: the hold endpoint of the money API.
 *
 * <p>These are the tests that decide whether the control is real. Refusing on the
 * guard is not enough — a refusal that happens after {@code reserve()} would leave
 * the customer's funds held for a payment that was never accepted, and one that
 * forgets to release on cancellation would burn a day's limit on a payment that
 * failed.
 */
class HoldLimitEnforcementTest {

    private AccountRepository accountRepository;
    private AccountHoldRepository accountHoldRepository;
    private OutboxWriter outboxWriter;
    private AccountLimitRepository accountLimitRepository;
    private InMemoryLimitUsage usage;
    private InternalAccountApplicationService service;
    private Account account;

    @BeforeEach
    void setUp() {
        accountRepository = mock(AccountRepository.class);
        accountHoldRepository = mock(AccountHoldRepository.class);
        LedgerEntryRepository ledgerEntryRepository = mock(LedgerEntryRepository.class);
        LedgerPostingService ledgerPostingService = mock(LedgerPostingService.class);
        outboxWriter = mock(OutboxWriter.class);
        accountLimitRepository = mock(AccountLimitRepository.class);
        LimitUsageRepository limitUsageRepository = mock(LimitUsageRepository.class);
        usage = InMemoryLimitUsage.attachedTo(limitUsageRepository);

        AccountLimitGuard guard = new AccountLimitGuard(accountLimitRepository, limitUsageRepository,
                accountHoldRepository, new AccountLimitMetrics(new SimpleMeterRegistry()), 10, Duration.ofMinutes(5));

        // The production wiring: the same UTC clock the application context builds.
        service = new InternalAccountApplicationService(accountRepository, accountHoldRepository,
                ledgerEntryRepository, ledgerPostingService, outboxWriter, guard, Clock.systemUTC(),
                Duration.ofMinutes(15));

        account = Account.open("U-1", "+77001234567", "Aisha", AccountType.CUSTOMER, Currency.KZT);
        account.credit(1_000_000, Currency.KZT);

        when(accountRepository.findByIdForUpdate(account.getId())).thenReturn(Optional.of(account));
        when(accountHoldRepository.findByIdempotencyKey(anyString())).thenReturn(Optional.empty());
        when(accountHoldRepository.save(any(AccountHold.class))).thenAnswer(call -> call.getArgument(0));
        when(accountLimitRepository.findByAccountId(account.getId())).thenReturn(List.of());
    }

    private void dailyLimit(long outgoingLimitMinor) {
        when(accountLimitRepository.findByAccountId(account.getId())).thenReturn(List.of(
                AccountLimit.configure(account.getId(), LimitWindow.DAILY, outgoingLimitMinor, Currency.KZT)));
    }

    private InternalAccountApplicationService.PlaceHoldResult place(String key, long amountMinor) {
        return service.placeHold(account.getId(), amountMinor, Currency.KZT, "PAYMENT", "P-" + key, key, "test");
    }

    @Test
    @DisplayName("an over-limit hold is refused before a single tiyn is reserved")
    void over_limit_hold_reserves_nothing() {
        dailyLimit(10_000);
        usage.seed(account.getId(), LimitWindow.DAILY, LimitWindow.DAILY.startOf(Instant.now()), 9_500, Currency.KZT);

        assertThatThrownBy(() -> place("key-1", 1_000))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.LIMIT_EXCEEDED);

        assertThat(account.getHeldMinor()).isZero();
        assertThat(account.availableMinor()).isEqualTo(1_000_000);
        verify(accountHoldRepository, never()).save(any());
        verify(outboxWriter, never()).append(anyString(), anyString(), anyString(), anyString(), anyLong(), any());
        // The refused operation must not be charged to the window either.
        assertThat(usage.totalUsed(account.getId(), LimitWindow.DAILY)).isEqualTo(9_500);
    }

    @Test
    @DisplayName("a hold inside the limit reserves the funds and charges the window")
    void hold_within_the_limit_is_charged_to_the_window() {
        dailyLimit(10_000);

        InternalAccountApplicationService.PlaceHoldResult result = place("key-2", 4_000);

        assertThat(result.hold().getStatus()).isEqualTo(HoldStatus.ACTIVE);
        assertThat(account.getHeldMinor()).isEqualTo(4_000);
        assertThat(usage.totalUsed(account.getId(), LimitWindow.DAILY)).isEqualTo(4_000);
        assertThat(usage.totalUsed(account.getId(), LimitWindow.MONTHLY)).isEqualTo(4_000);
    }

    @Test
    @DisplayName("a released hold gives the day's budget back, so the same payment can be retried")
    void released_hold_does_not_consume_the_limit_forever() {
        dailyLimit(10_000);

        InternalAccountApplicationService.PlaceHoldResult first = place("key-3", 10_000);
        assertThat(usage.totalUsed(account.getId(), LimitWindow.DAILY)).isEqualTo(10_000);

        assertThatThrownBy(() -> place("key-4", 10_000))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.LIMIT_EXCEEDED);

        AccountHold hold = first.hold();
        when(accountHoldRepository.findByIdForUpdate(hold.getId())).thenReturn(Optional.of(hold));
        service.releaseHold(hold.getId(), "customer cancelled");

        assertThat(hold.getStatus()).isEqualTo(HoldStatus.RELEASED);
        assertThat(usage.totalUsed(account.getId(), LimitWindow.DAILY)).isZero();

        // The rule this service chose: committed value counts while it is committed.
        // A failed payment must not eat the ceiling of the customer who retries it.
        InternalAccountApplicationService.PlaceHoldResult retried = place("key-5", 10_000);
        assertThat(retried.replayed()).isFalse();
        assertThat(account.getHeldMinor()).isEqualTo(10_000);
    }

    @Test
    @DisplayName("velocity refuses the hold and reserves nothing")
    void velocity_refusal_reaches_the_hold_path() {
        when(accountHoldRepository.countByAccountIdAndCreatedAtAfter(anyString(), any(Instant.class)))
                .thenReturn(10L);

        assertThatThrownBy(() -> place("key-6", 1_000))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.VELOCITY_EXCEEDED);

        assertThat(account.getHeldMinor()).isZero();
        verify(accountHoldRepository, never()).save(any());
    }
}
