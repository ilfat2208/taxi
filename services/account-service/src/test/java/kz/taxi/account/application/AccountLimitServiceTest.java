package kz.taxi.account.application;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountLimit;
import kz.taxi.account.domain.AccountType;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountLimitRepository;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.account.infrastructure.LimitUsageRepository;
import kz.taxi.account.support.InMemoryLimitUsage;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The operator-facing limit API: who may use it, what it reports, and where the
 * numbers come from.
 *
 * <p>Two rules are worth more than the rest of the class: limits are ADMIN-only
 * (a support agent raising a ceiling unnoticed is the insider-fraud story), and
 * the currency of a limit always comes from the account, never from the request.
 */
class AccountLimitServiceTest {

    private static final Instant NOW = Instant.parse("2025-03-14T10:15:30Z");

    private final AuthenticatedUser operator =
            new AuthenticatedUser("op-1", "+77000000000", "Operator", Set.of(Roles.ADMIN));
    private final AuthenticatedUser customer =
            new AuthenticatedUser("U-1", "+77001234567", "Aisha", Set.of(Roles.CUSTOMER));

    /** Stands in for the account_limit table; the service really must be able to read back what it saved. */
    private final List<AccountLimit> storedLimits = new ArrayList<>();

    private AccountRepository accountRepository;
    private AccountLimitRepository accountLimitRepository;
    private AccountHoldRepository accountHoldRepository;
    private InMemoryLimitUsage usage;
    private AccountLimitService service;
    private Account account;

    @BeforeEach
    void setUp() {
        accountRepository = mock(AccountRepository.class);
        accountLimitRepository = mock(AccountLimitRepository.class);
        LimitUsageRepository limitUsageRepository = mock(LimitUsageRepository.class);
        accountHoldRepository = mock(AccountHoldRepository.class);
        usage = InMemoryLimitUsage.attachedTo(limitUsageRepository);
        storedLimits.clear();
        account = account();

        when(accountRepository.findById("A-1")).thenReturn(Optional.of(account));
        when(accountLimitRepository.findByAccountId(anyString())).thenAnswer(call -> List.copyOf(storedLimits));
        when(accountLimitRepository.findByAccountIdAndWindow(anyString(), any())).thenAnswer(call ->
                storedLimits.stream().filter(limit -> limit.getWindow() == call.getArgument(1)).findFirst());
        when(accountLimitRepository.save(any(AccountLimit.class))).thenAnswer(call -> {
            AccountLimit limit = call.getArgument(0);
            storedLimits.add(limit);
            return limit;
        });

        AccountLimitGuard guard = new AccountLimitGuard(accountLimitRepository, limitUsageRepository,
                accountHoldRepository, new AccountLimitMetrics(new SimpleMeterRegistry()), 10, Duration.ofMinutes(5));
        service = new AccountLimitService(accountRepository, accountLimitRepository, guard,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private Account account() {
        Account opened = Account.open("U-1", "+77001234567", "Aisha", AccountType.CUSTOMER, Currency.KZT);
        opened.credit(1_000_000, Currency.KZT);
        return opened;
    }

    private AccountLimit givenLimit(LimitWindow window, long outgoingLimitMinor) {
        AccountLimit limit = AccountLimit.configure(account.getId(), window, outgoingLimitMinor, Currency.KZT);
        storedLimits.add(limit);
        return limit;
    }

    // ------------------------------------------------------------------ reads

    @Test
    @DisplayName("an operator sees the configured limit, its usage and the reset moment")
    void operator_reads_limits_with_usage() {
        givenLimit(LimitWindow.DAILY, 500_000);
        usage.seed(account.getId(), LimitWindow.DAILY, LimitWindow.DAILY.startOf(NOW), 120_000, Currency.KZT);
        usage.seed(account.getId(), LimitWindow.MONTHLY, LimitWindow.MONTHLY.startOf(NOW), 120_000, Currency.KZT);
        when(accountHoldRepository.countByAccountIdAndCreatedAtAfter(any(), any())).thenReturn(3L);

        AccountLimitsSnapshot snapshot = service.read("A-1", operator);

        assertThat(snapshot.currency()).isEqualTo(Currency.KZT);
        assertThat(snapshot.limits()).hasSize(2);

        AccountLimitsSnapshot.WindowLimit daily = snapshot.limits().get(0);
        assertThat(daily.window()).isEqualTo(LimitWindow.DAILY);
        assertThat(daily.configured()).isTrue();
        assertThat(daily.outgoingLimitMinor()).isEqualTo(500_000);
        assertThat(daily.usedMinor()).isEqualTo(120_000);
        assertThat(daily.remainingMinor()).isEqualTo(380_000);
        assertThat(daily.windowStart()).isEqualTo(Instant.parse("2025-03-14T00:00:00Z"));
        assertThat(daily.windowEnd()).isEqualTo(Instant.parse("2025-03-15T00:00:00Z"));

        AccountLimitsSnapshot.WindowLimit monthly = snapshot.limits().get(1);
        assertThat(monthly.window()).isEqualTo(LimitWindow.MONTHLY);
        assertThat(monthly.configured()).isFalse();
        assertThat(monthly.outgoingLimitMinor()).isNull();
        assertThat(monthly.remainingMinor()).isNull();
        // Usage of an unconfigured window is still reported: an operator about to set a
        // limit must not refuse a payment the customer already made today.
        assertThat(monthly.usedMinor()).isEqualTo(120_000);

        assertThat(snapshot.velocity().enabled()).isTrue();
        assertThat(snapshot.velocity().maxOperations()).isEqualTo(10);
        assertThat(snapshot.velocity().window()).isEqualTo(Duration.ofMinutes(5));
        assertThat(snapshot.velocity().operationsInWindow()).isEqualTo(3);
    }

    @Test
    @DisplayName("an unknown account is a 404, not an empty limit list")
    void unknown_account_is_not_found() {
        DomainException failure = catchThrowableOfType(
                () -> service.read("missing", operator), DomainException.class);

        assertThat(failure.errorCode()).isEqualTo(AccountErrorCode.ACCOUNT_NOT_FOUND);
    }

    // ------------------------------------------------------------------ writes

    @Test
    @DisplayName("setting a limit stores the account's own currency, whatever the caller believes")
    void setting_a_limit_uses_the_account_currency() {
        AccountLimitsSnapshot snapshot = service.setLimit("A-1", LimitWindow.DAILY, 250_000, operator);

        ArgumentCaptor<AccountLimit> saved = ArgumentCaptor.forClass(AccountLimit.class);
        verify(accountLimitRepository).save(saved.capture());
        // The limit is stored against the id from the request path, not against whatever
        // the loaded entity happens to carry.
        assertThat(saved.getValue().getAccountId()).isEqualTo("A-1");
        assertThat(saved.getValue().getWindow()).isEqualTo(LimitWindow.DAILY);
        assertThat(saved.getValue().getOutgoingLimitMinor()).isEqualTo(250_000);
        assertThat(saved.getValue().getCurrency()).isEqualTo(Currency.KZT);

        assertThat(snapshot.limits()).anySatisfy(limit -> {
            assertThat(limit.window()).isEqualTo(LimitWindow.DAILY);
            assertThat(limit.configured()).isTrue();
            assertThat(limit.outgoingLimitMinor()).isEqualTo(250_000);
            assertThat(limit.remainingMinor()).isEqualTo(250_000);
        });
    }

    @Test
    @DisplayName("changing a limit updates the existing row instead of inserting a second one")
    void changing_a_limit_updates_in_place() {
        AccountLimit existing = givenLimit(LimitWindow.MONTHLY, 1_000_000);

        service.setLimit("A-1", LimitWindow.MONTHLY, 400_000, operator);

        assertThat(existing.getOutgoingLimitMinor()).isEqualTo(400_000);
        assertThat(storedLimits).hasSize(1);
        verify(accountLimitRepository, never()).save(any());
    }

    @Test
    @DisplayName("a zero limit is rejected: a limit is a ceiling, not a freeze")
    void a_non_positive_limit_is_rejected() {
        assertThatThrownBy(() -> service.setLimit("A-1", LimitWindow.DAILY, 0, operator))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(AccountErrorCode.INVALID_AMOUNT);

        DomainException missingWindow = catchThrowableOfType(
                () -> service.setLimit("A-1", null, 1_000, operator), DomainException.class);
        assertThat(missingWindow.errorCode()).isEqualTo(CommonErrorCode.VALIDATION_FAILED);

        verify(accountLimitRepository, never()).save(any());
    }

    // ------------------------------------------------------------------ authorization

    @Test
    @DisplayName("a customer cannot read or change transaction limits")
    void only_an_operator_may_touch_limits() {
        DomainException read = catchThrowableOfType(() -> service.read("A-1", customer), DomainException.class);
        assertThat(read.errorCode()).isEqualTo(CommonErrorCode.FORBIDDEN);

        DomainException write = catchThrowableOfType(
                () -> service.setLimit("A-1", LimitWindow.DAILY, 250_000, customer), DomainException.class);
        assertThat(write.errorCode()).isEqualTo(CommonErrorCode.FORBIDDEN);
        assertThat(write.errorCode().httpStatus()).isEqualTo(403);

        verify(accountLimitRepository, never()).save(any());
    }
}
