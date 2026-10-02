package kz.taxi.account.application;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountLimit;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountLimitRepository;
import kz.taxi.account.infrastructure.LimitUsageRepository;
import kz.taxi.account.support.InMemoryLimitUsage;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The fraud controls themselves: what is refused, what is allowed, and what the
 * refusal tells the client.
 *
 * <p>The interesting cases are the boundaries. "Under the limit" is easy; the
 * money questions are whether exactly-at-the-limit passes (it must — a limit of
 * 100 000 means 100 000, not 99 999), which of two windows refuses when both are
 * configured, and whether a released hold gives its budget back.
 */
class AccountLimitGuardTest {

    private static final Instant NOW = Instant.parse("2025-03-14T10:15:30Z");
    private static final Instant PLACED_AT = Instant.parse("2025-01-31T23:30:00Z");

    private AccountLimitRepository accountLimitRepository;
    private LimitUsageRepository limitUsageRepository;
    private AccountHoldRepository accountHoldRepository;
    private SimpleMeterRegistry registry;
    private InMemoryLimitUsage usage;
    private AccountLimitGuard guard;
    private Account account;

    @BeforeEach
    void setUp() {
        accountLimitRepository = mock(AccountLimitRepository.class);
        limitUsageRepository = mock(LimitUsageRepository.class);
        accountHoldRepository = mock(AccountHoldRepository.class);
        registry = new SimpleMeterRegistry();
        usage = InMemoryLimitUsage.attachedTo(limitUsageRepository);
        account = account();

        guard = guardWith(10);
        // Default for this suite: no limit configured, i.e. unlimited.
        when(accountLimitRepository.findByAccountId(account.getId())).thenReturn(List.of());
    }

    private AccountLimitGuard guardWith(int velocityMaxOperations) {
        return new AccountLimitGuard(accountLimitRepository, limitUsageRepository, accountHoldRepository,
                new AccountLimitMetrics(registry), velocityMaxOperations, Duration.ofMinutes(5));
    }

    private Account account() {
        Account opened = Account.open("U-1", "+77001234567", "Aisha", AccountType.CUSTOMER, Currency.KZT);
        opened.credit(10_000_000, Currency.KZT);
        return opened;
    }

    /** Configures the windows that should have a limit; 0 means "not configured". */
    private void configure(long dailyLimitMinor, long monthlyLimitMinor) {
        List<AccountLimit> configured = new ArrayList<>();
        if (dailyLimitMinor > 0) {
            configured.add(AccountLimit.configure(account.getId(), LimitWindow.DAILY, dailyLimitMinor, Currency.KZT));
        }
        if (monthlyLimitMinor > 0) {
            configured.add(AccountLimit.configure(account.getId(), LimitWindow.MONTHLY, monthlyLimitMinor, Currency.KZT));
        }
        when(accountLimitRepository.findByAccountId(account.getId())).thenReturn(configured);
    }

    private void committed(LimitWindow window, Instant at, long usedMinor) {
        usage.seed(account.getId(), window, window.startOf(at), usedMinor, Currency.KZT);
    }

    private long used(LimitWindow window, Instant at) {
        return usage.used(account.getId(), window, at);
    }

    private static DomainException refusal(Runnable operation) {
        return catchThrowableOfType(operation::run, DomainException.class);
    }

    // ------------------------------------------------------------------ amount limits

    @Test
    @DisplayName("a hold inside the daily limit is allowed and accumulates usage")
    void hold_within_the_limit_is_allowed_and_counted() {
        configure(10_000, 0);
        committed(LimitWindow.DAILY, NOW, 3_000);

        assertThatCode(() -> guard.ensureAllowed(account, 5_000, Currency.KZT, NOW))
                .doesNotThrowAnyException();

        guard.recordPlacement(account, 5_000, Currency.KZT, NOW);

        assertThat(used(LimitWindow.DAILY, NOW)).isEqualTo(8_000);
    }

    @Test
    @DisplayName("a hold that lands exactly on the limit is allowed: 100 000 means 100 000")
    void hold_exactly_at_the_limit_is_allowed() {
        configure(10_000, 0);
        committed(LimitWindow.DAILY, NOW, 5_000);

        assertThatCode(() -> guard.ensureAllowed(account, 5_000, Currency.KZT, NOW))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("one minor unit over the limit is refused with the numbers the client needs")
    void hold_over_the_limit_is_refused_with_details() {
        configure(10_000, 0);
        committed(LimitWindow.DAILY, NOW, 5_000);

        DomainException failure = refusal(() -> guard.ensureAllowed(account, 5_001, Currency.KZT, NOW));

        assertThat(failure.errorCode()).isEqualTo(AccountErrorCode.LIMIT_EXCEEDED);
        assertThat(failure.details())
                .containsEntry("accountId", account.getId())
                .containsEntry("window", "DAILY")
                .containsEntry("currency", "KZT")
                .containsEntry("limitMinor", 10_000L)
                .containsEntry("usedMinor", 5_000L)
                .containsEntry("requestedMinor", 5_001L)
                .containsEntry("remainingMinor", 5_000L);

        assertThat(registry.get(AccountLimitMetrics.REFUSALS)
                .tag(AccountLimitMetrics.REASON_TAG, "LIMIT_EXCEEDED")
                .tag(AccountLimitMetrics.WINDOW_TAG, "DAILY")
                .counter().count()).isEqualTo(1.0d);
    }

    @Test
    @DisplayName("with no limit row the account is unlimited")
    void missing_limit_means_unlimited() {
        assertThatCode(() -> guard.ensureAllowed(account, 900_000_000L, Currency.KZT, NOW))
                .doesNotThrowAnyException();
        assertThat(registry.find(AccountLimitMetrics.REFUSALS).counters()).isEmpty();
    }

    @Test
    @DisplayName("the daily window refuses when it is the tighter of the two")
    void daily_limit_refuses_when_it_is_tighter() {
        configure(10_000, 1_000_000);
        committed(LimitWindow.DAILY, NOW, 5_000);
        committed(LimitWindow.MONTHLY, NOW, 5_000);

        DomainException failure = refusal(() -> guard.ensureAllowed(account, 6_000, Currency.KZT, NOW));

        assertThat(failure.errorCode()).isEqualTo(AccountErrorCode.LIMIT_EXCEEDED);
        assertThat(failure.details())
                .containsEntry("window", "DAILY")
                .containsEntry("limitMinor", 10_000L)
                .containsEntry("remainingMinor", 5_000L);
    }

    @Test
    @DisplayName("the monthly window refuses even when the daily window still has room")
    void monthly_limit_refuses_when_daily_is_looser() {
        configure(1_000_000, 50_000);
        committed(LimitWindow.DAILY, NOW, 100_000);
        committed(LimitWindow.MONTHLY, NOW, 45_000);

        DomainException failure = refusal(() -> guard.ensureAllowed(account, 6_000, Currency.KZT, NOW));

        assertThat(failure.errorCode()).isEqualTo(AccountErrorCode.LIMIT_EXCEEDED);
        assertThat(failure.details())
                .containsEntry("window", "MONTHLY")
                .containsEntry("limitMinor", 50_000L)
                .containsEntry("usedMinor", 45_000L)
                .containsEntry("requestedMinor", 6_000L);
    }

    @Test
    @DisplayName("a currency mismatch is left to the account rule instead of being reported as a limit")
    void currency_mismatch_is_not_a_limit_refusal() {
        configure(100, 0);

        assertThatCode(() -> guard.ensureAllowed(account, 1_000, Currency.USD, NOW))
                .doesNotThrowAnyException();
    }

    // ------------------------------------------------------------------ velocity

    @Test
    @DisplayName("the operation after the maximum number of operations in the window is refused")
    void velocity_refuses_once_the_maximum_is_reached() {
        when(accountHoldRepository.countByAccountIdAndCreatedAtAfter(account.getId(),
                NOW.minus(Duration.ofMinutes(5)))).thenReturn(10L);

        DomainException failure = refusal(() -> guard.ensureAllowed(account, 1_000, Currency.KZT, NOW));

        assertThat(failure.errorCode()).isEqualTo(AccountErrorCode.VELOCITY_EXCEEDED);
        assertThat(failure.details())
                .containsEntry("accountId", account.getId())
                .containsEntry("maxOperations", 10)
                .containsEntry("operationsInWindow", 10L)
                .containsEntry("velocityWindow", "PT5M");

        assertThat(registry.get(AccountLimitMetrics.REFUSALS)
                .tag(AccountLimitMetrics.REASON_TAG, "VELOCITY_EXCEEDED")
                .tag(AccountLimitMetrics.WINDOW_TAG, "VELOCITY")
                .counter().count()).isEqualTo(1.0d);
    }

    @Test
    @DisplayName("operations up to the maximum are allowed through")
    void velocity_allows_operations_up_to_the_maximum() {
        when(accountHoldRepository.countByAccountIdAndCreatedAtAfter(anyString(), any(Instant.class)))
                .thenReturn(9L);

        assertThatCode(() -> guard.ensureAllowed(account, 1_000, Currency.KZT, NOW))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("velocity is off when max-operations is not positive, and is never even queried")
    void velocity_is_disabled_by_a_non_positive_maximum() {
        AccountLimitGuard disabled = guardWith(0);

        assertThatCode(() -> disabled.ensureAllowed(account, 1_000, Currency.KZT, NOW))
                .doesNotThrowAnyException();

        assertThat(disabled.velocityEnabled()).isFalse();
        assertThat(disabled.operationsInVelocityWindow(account.getId(), NOW)).isZero();
        verify(accountHoldRepository, never()).countByAccountIdAndCreatedAtAfter(anyString(), any(Instant.class));
    }

    // ------------------------------------------------------------------ usage accounting

    @Test
    @DisplayName("a released hold gives its budget back, so the same payment can be retried")
    void release_returns_the_limit_budget() {
        configure(10_000, 0);
        committed(LimitWindow.DAILY, PLACED_AT, 10_000);

        assertThatThrownBy(() -> guard.ensureAllowed(account, 10_000, Currency.KZT, PLACED_AT))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.LIMIT_EXCEEDED);

        guard.recordRelease(account, 10_000, PLACED_AT);

        assertThat(used(LimitWindow.DAILY, PLACED_AT)).isZero();
        assertThatCode(() -> guard.ensureAllowed(account, 10_000, Currency.KZT, PLACED_AT))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a release refunds the window the hold was charged to, not the current one")
    void release_targets_the_placement_window() {
        Instant currentDay = Instant.parse("2025-03-14T09:00:00Z");
        committed(LimitWindow.DAILY, PLACED_AT, 4_000);

        guard.recordRelease(account, 4_000, PLACED_AT);

        // Yesterday's bucket is credited; refunding "now" instead would hand out budget in
        // a window that never carried the commitment.
        assertThat(used(LimitWindow.DAILY, PLACED_AT)).isZero();
        assertThat(used(LimitWindow.DAILY, currentDay)).isZero();
    }

    @Test
    @DisplayName("a release never drives committed value below zero")
    void release_never_goes_negative() {
        committed(LimitWindow.DAILY, PLACED_AT, 3_000);

        guard.recordRelease(account, 5_000, PLACED_AT);

        // A negative "already spent" would silently widen the limit — the one direction
        // of error that costs money.
        assertThat(used(LimitWindow.DAILY, PLACED_AT)).isZero();
    }

    @Test
    @DisplayName("placing a hold records usage for every window, even an unconfigured one")
    void placement_records_both_windows() {
        guard.recordPlacement(account, 7_000, Currency.KZT, NOW);

        assertThat(used(LimitWindow.DAILY, NOW)).isEqualTo(7_000);
        assertThat(used(LimitWindow.MONTHLY, NOW)).isEqualTo(7_000);
    }

    @Test
    @DisplayName("a hold charged to yesterday's window does not consume today's limit")
    void a_previous_windows_usage_does_not_carry_over() {
        configure(10_000, 0);
        committed(LimitWindow.DAILY, PLACED_AT, 10_000);

        assertThatCode(() -> guard.ensureAllowed(account, 10_000, Currency.KZT, NOW))
                .doesNotThrowAnyException();
    }
}
