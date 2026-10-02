package kz.taxi.account.application;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountLimit;
import kz.taxi.account.domain.LimitUsage;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.account.infrastructure.AccountHoldRepository;
import kz.taxi.account.infrastructure.AccountLimitRepository;
import kz.taxi.account.infrastructure.LimitUsageRepository;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;

/**
 * Transaction limits and velocity: the cheapest fraud control there is, applied
 * where the money is.
 *
 * <p>Enforcement happens on the HOLD path, never at capture. A hold is the moment
 * funds stop being available to the customer, so refusing there means the
 * attacker never gets the money and the customer never gets a confusing "your
 * payment failed after the merchant shipped" ticket. Checking at capture instead
 * would allow unlimited commitments and only reject them later — by which time the
 * payments are already in flight.
 *
 * <p>Two independent controls, deliberately with different codes so a client can
 * tell the customer what to do about it:
 * <ul>
 *   <li>{@code LIMIT_EXCEEDED} — the amount would push the window's committed
 *       value past the configured ceiling. "You can spend X more today."</li>
 *   <li>{@code VELOCITY_EXCEEDED} — too many outgoing operations in a short
 *       period, whatever their size. This is the control that catches card
 *       testing and scripted cash-out, where every individual amount looks
 *       innocent. "Too many attempts, try again in a few minutes."</li>
 * </ul>
 *
 * <p>Both refuse <em>before</em> {@code Account.reserve} runs, so a refused
 * operation cannot leave reserved funds behind.
 *
 * <p>Concurrency: every caller of this class holds the account row lock (the
 * application services lock the account before touching a hold), which is what
 * makes "read usage, compare, add usage" safe without a second lock. See
 * {@link AccountLimitGuard#recordPlacement} for why the counter lives in the same
 * transaction as the hold.
 */
@Service
@Slf4j
public class AccountLimitGuard {

    private final AccountLimitRepository accountLimitRepository;
    private final LimitUsageRepository limitUsageRepository;
    private final AccountHoldRepository accountHoldRepository;
    private final AccountLimitMetrics metrics;
    private final int velocityMaxOperations;
    private final Duration velocityWindow;

    public AccountLimitGuard(AccountLimitRepository accountLimitRepository,
                             LimitUsageRepository limitUsageRepository,
                             AccountHoldRepository accountHoldRepository,
                             AccountLimitMetrics metrics,
                             @Value("${taxi.account.velocity.max-operations:10}") int velocityMaxOperations,
                             @Value("${taxi.account.velocity.window:5m}") Duration velocityWindow) {
        this.accountLimitRepository = accountLimitRepository;
        this.limitUsageRepository = limitUsageRepository;
        this.accountHoldRepository = accountHoldRepository;
        this.metrics = metrics;
        this.velocityMaxOperations = velocityMaxOperations;
        this.velocityWindow = velocityWindow;
        if (velocityMaxOperations <= 0) {
            log.info("velocity control is disabled (taxi.account.velocity.max-operations={})", velocityMaxOperations);
        }
    }

    // ------------------------------------------------------------------ enforcement

    /**
     * Refuses an outgoing operation that must not happen, before anything is reserved.
     *
     * @param now the instant the operation is being evaluated at; window boundaries
     *            and the velocity window are both measured from it
     * @throws DomainException {@code LIMIT_EXCEEDED} or {@code VELOCITY_EXCEEDED}
     */
    public void ensureAllowed(Account account, long amountMinor, Currency currency, Instant now) {
        if (currency != null && currency != account.getCurrency()) {
            // Account.reserve() rejects this with CURRENCY_MISMATCH. Reporting a limit
            // refusal here would blame the ceiling for a client bug and send the
            // customer to support with the wrong story.
            return;
        }
        ensureWithinAmountLimits(account, amountMinor, now);
        ensureWithinVelocity(account, now);
    }

    private void ensureWithinAmountLimits(Account account, long amountMinor, Instant now) {
        var configured = accountLimitRepository.findByAccountId(account.getId());
        if (configured.isEmpty()) {
            // No row means no limit configured, i.e. unlimited. Documented default:
            // see V2__account_limits.sql for why a migration must not invent one.
            return;
        }

        // Both windows are always evaluated and the tightest violation is reported:
        // a customer with a generous daily and a nearly exhausted monthly limit
        // needs to hear about the monthly one, because that is the one they cannot
        // solve by waiting a few hours.
        AccountLimit tightest = null;
        long tightestUsed = 0L;
        for (AccountLimit limit : configured) {
            long used = usedMinor(account.getId(), limit.getWindow(), now);
            if (limit.allows(used, amountMinor)) {
                continue;
            }
            if (tightest == null || limit.headroomMinor(used) < tightest.headroomMinor(tightestUsed)) {
                tightest = limit;
                tightestUsed = used;
            }
        }
        if (tightest == null) {
            return;
        }

        LimitWindow window = tightest.getWindow();
        metrics.recordRefusal(AccountErrorCode.LIMIT_EXCEEDED.code(), window.name());
        log.info("refused hold of {} on account {}: {}-window limit {} already {} committed",
                Money.ofMinor(amountMinor, account.getCurrency()), account.getId(), window,
                Money.ofMinor(tightest.getOutgoingLimitMinor(), tightest.getCurrency()),
                Money.ofMinor(tightestUsed, tightest.getCurrency()));

        throw DomainException.of(AccountErrorCode.LIMIT_EXCEEDED,
                        "holding {} would exceed the {} outgoing limit of {} ({} already committed in this window)",
                        Money.ofMinor(amountMinor, account.getCurrency()), window,
                        Money.ofMinor(tightest.getOutgoingLimitMinor(), tightest.getCurrency()),
                        Money.ofMinor(tightestUsed, tightest.getCurrency()))
                .withDetail("accountId", account.getId())
                .withDetail("window", window.name())
                .withDetail("currency", tightest.getCurrency().name())
                .withDetail("limitMinor", tightest.getOutgoingLimitMinor())
                .withDetail("usedMinor", tightestUsed)
                .withDetail("requestedMinor", amountMinor)
                .withDetail("remainingMinor", Math.max(0L, tightest.headroomMinor(tightestUsed)));
    }

    private void ensureWithinVelocity(Account account, Instant now) {
        if (velocityMaxOperations <= 0) {
            // Disabled by configuration (max-operations <= 0): an operator escaping a
            // false positive must not have to redeploy the service.
            return;
        }
        long recent = accountHoldRepository.countByAccountIdAndCreatedAtAfter(
                account.getId(), now.minus(velocityWindow));
        if (recent < velocityMaxOperations) {
            return;
        }

        metrics.recordRefusal(AccountErrorCode.VELOCITY_EXCEEDED.code(), AccountLimitMetrics.VELOCITY);
        log.info("refused hold on account {}: {} outgoing operations in the last {} (maximum {})",
                account.getId(), recent, velocityWindow, velocityMaxOperations);

        throw DomainException.of(AccountErrorCode.VELOCITY_EXCEEDED,
                        "account {} started {} outgoing operations in the last {}, which is the maximum of {}",
                        account.getId(), recent, velocityWindow, velocityMaxOperations)
                .withDetail("accountId", account.getId())
                .withDetail("maxOperations", velocityMaxOperations)
                .withDetail("operationsInWindow", recent)
                .withDetail("velocityWindow", velocityWindow.toString())
                .withDetail("requestedMinor", 0L);
    }

    // ------------------------------------------------------------------ usage accounting

    /**
     * Records that {@code amountMinor} has been committed in the current buckets.
     *
     * <p>Called in the same transaction as the hold insert. That is the whole
     * reason this counter is trustworthy: a hold that rolls back takes its usage
     * change with it, and the account row lock means no two holds interleave
     * between the check and the increment.
     *
     * @param at the instant of the hold (its {@code createdAt}); the bucket is
     *           derived from it, and {@link #recordRelease} derives the same bucket
     *           from the same field, so a charge and its refund can never land in
     *           different windows
     */
    public void recordPlacement(Account account, long amountMinor, Currency currency, Instant at) {
        for (LimitWindow window : LimitWindow.values()) {
            Instant bucket = window.startOf(at);
            LimitUsage usage = limitUsageRepository
                    .findByAccountIdAndWindowAndWindowStart(account.getId(), window, bucket)
                    .orElseGet(() -> limitUsageRepository.save(
                            LimitUsage.opening(account.getId(), window, bucket, currency)));
            usage.add(amountMinor);
        }
    }

    /**
     * Gives limit budget back when a hold is released or expires.
     *
     * <p>The rule this service chose: committed value counts while it is committed.
     * A released hold consumed nothing, so it must not consume the limit forever —
     * otherwise a failed payment would permanently eat a customer's daily ceiling
     * and the second attempt of the same purchase would be refused for a payment
     * that never happened.
     *
     * <p>The bucket comes from the hold's own {@code createdAt}, not from "now":
     * the amount was charged to the window it was placed in, so it must be
     * refunded to that window even if the release happens days later.
     *
     * @param placedAt the instant the hold was placed ({@code hold.getCreatedAt()})
     */
    public void recordRelease(Account account, long amountMinor, Instant placedAt) {
        for (LimitWindow window : LimitWindow.values()) {
            limitUsageRepository
                    .findByAccountIdAndWindowAndWindowStart(account.getId(), window, window.startOf(placedAt))
                    // Absent means nothing was ever counted in that bucket, so there is
                    // nothing to give back; creating a row just to write zero would grow
                    // this table for accounts that never placed a hold.
                    .ifPresent(usage -> usage.subtract(amountMinor));
        }
    }

    /** Committed value for one window of one account, as of {@code now}. */
    public long usedMinor(String accountId, LimitWindow window, Instant now) {
        return limitUsageRepository
                .findByAccountIdAndWindowAndWindowStart(accountId, window, window.startOf(now))
                .map(LimitUsage::getUsedMinor)
                .orElse(0L);
    }

    /** Outgoing operations started in the velocity window; 0 when the control is off. */
    public long operationsInVelocityWindow(String accountId, Instant now) {
        if (velocityMaxOperations <= 0) {
            return 0L;
        }
        return accountHoldRepository.countByAccountIdAndCreatedAtAfter(accountId, now.minus(velocityWindow));
    }

    public boolean velocityEnabled() {
        return velocityMaxOperations > 0;
    }

    public int velocityMaxOperations() {
        return velocityMaxOperations;
    }

    public Duration velocityWindow() {
        return velocityWindow;
    }
}
