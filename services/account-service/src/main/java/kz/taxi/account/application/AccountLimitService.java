package kz.taxi.account.application;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountLimit;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.account.infrastructure.AccountLimitRepository;
import kz.taxi.account.infrastructure.AccountRepository;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The operator's view of transaction limits: read what is configured, and change
 * it.
 *
 * <p>Operator-only ({@code ADMIN}), and the check lives here rather than in the
 * controller: "who may raise a customer's limit" is a business rule, and a rule
 * enforced in one place cannot be forgotten by the next endpoint that touches
 * limits. Support is deliberately excluded — reading a limit is harmless, but this
 * API also writes, and a support agent silently raising a ceiling is exactly the
 * insider-fraud scenario limits exist to make visible.
 *
 * <p>No {@code Idempotency-Key} is required, unlike the endpoints that move money:
 * a PUT of a limit is declarative and naturally idempotent (setting the same limit
 * twice leaves the same state), so a replay cannot invent money or duplicate an
 * effect. See the platform convention on idempotency — it applies to operations
 * that move money or create orders.
 */
@Service
@Slf4j
public class AccountLimitService {

    private final AccountRepository accountRepository;
    private final AccountLimitRepository accountLimitRepository;
    private final AccountLimitGuard limitGuard;
    private final Clock clock;

    public AccountLimitService(AccountRepository accountRepository,
                               AccountLimitRepository accountLimitRepository,
                               AccountLimitGuard limitGuard,
                               Clock clock) {
        this.accountRepository = accountRepository;
        this.accountLimitRepository = accountLimitRepository;
        this.limitGuard = limitGuard;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ reads

    @Transactional(readOnly = true)
    public AccountLimitsSnapshot read(String accountId, AuthenticatedUser requester) {
        requireOperator(requester, "read");
        return snapshot(requireAccount(accountId), clock.instant());
    }

    // ------------------------------------------------------------------ writes

    /**
     * Sets or changes the outgoing limit of one window.
     *
     * <p>The currency comes from the account, never from the request: a KZT limit
     * stored on a USD account would compare tiyn against cents and quietly allow a
     * hundred times the intended exposure.
     */
    @Transactional
    public AccountLimitsSnapshot setLimit(String accountId,
                                          LimitWindow window,
                                          long outgoingLimitMinor,
                                          AuthenticatedUser requester) {
        requireOperator(requester, "change");
        if (window == null) {
            throw DomainException.validation("window is required, expected one of DAILY, MONTHLY")
                    .withDetail("supported", "DAILY, MONTHLY");
        }
        Account account = requireAccount(accountId);

        AccountLimit limit = accountLimitRepository.findByAccountIdAndWindow(accountId, window)
                .map(existing -> {
                    existing.changeOutgoingLimit(outgoingLimitMinor);
                    return existing;
                })
                .orElseGet(() -> accountLimitRepository.save(AccountLimit.configure(
                        accountId, window, outgoingLimitMinor, account.getCurrency())));

        log.info("operator {} set the {} outgoing limit of account {} to {} {}",
                requester.userId(), window, accountId, limit.getOutgoingLimitMinor(), limit.getCurrency());

        // Read back through the same snapshot builder so the caller sees exactly the
        // numbers the enforcement path will use on the next payment.
        return snapshot(account, clock.instant());
    }

    // ------------------------------------------------------------------ internals

    private AccountLimitsSnapshot snapshot(Account account, Instant now) {
        List<AccountLimit> configured = accountLimitRepository.findByAccountId(account.getId());
        List<AccountLimitsSnapshot.WindowLimit> windows = new ArrayList<>(LimitWindow.values().length);
        for (LimitWindow window : LimitWindow.values()) {
            AccountLimit limit = configured.stream()
                    .filter(candidate -> candidate.getWindow() == window)
                    .findFirst()
                    .orElse(null);
            long used = limitGuard.usedMinor(account.getId(), window, now);
            windows.add(new AccountLimitsSnapshot.WindowLimit(
                    window,
                    limit != null,
                    limit == null ? null : limit.getOutgoingLimitMinor(),
                    used,
                    limit == null ? null : Math.max(0L, limit.headroomMinor(used)),
                    window.startOf(now),
                    window.endOf(now),
                    limit == null ? null : limit.getUpdatedAt()));
        }
        return new AccountLimitsSnapshot(account.getId(), account.getCurrency(), windows,
                new AccountLimitsSnapshot.Velocity(limitGuard.velocityEnabled(),
                        limitGuard.velocityMaxOperations(),
                        limitGuard.velocityWindow(),
                        limitGuard.operationsInVelocityWindow(account.getId(), now)));
    }

    private Account requireAccount(String accountId) {
        return accountRepository.findById(accountId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.ACCOUNT_NOT_FOUND,
                                "account {} not found", accountId)
                        .withDetail("accountId", accountId));
    }

    private static void requireOperator(AuthenticatedUser requester, String action) {
        if (requester == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!requester.isAdmin()) {
            throw DomainException.forbidden("only an operator may {} transaction limits", action);
        }
    }
}
