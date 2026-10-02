package kz.taxi.account.support;

import kz.taxi.account.domain.LimitUsage;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.account.infrastructure.LimitUsageRepository;
import kz.taxi.common.core.money.Currency;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * An in-memory stand-in for the {@code limit_usage} table.
 *
 * <p>Usage accounting is stateful — a hold increments it and a release decrements
 * it — so a repository mock that always answers "empty" would test nothing. This
 * keeps the real bucket-keying semantics (one row per account, window and
 * {@code window_start}) on top of a plain map, which lets a test drive several
 * operations through the production code path and assert the resulting balance of
 * committed value.
 */
public final class InMemoryLimitUsage {

    private final Map<String, LimitUsage> rows = new LinkedHashMap<>();

    private InMemoryLimitUsage() {
    }

    /** Wires the store into a mocked repository. */
    public static InMemoryLimitUsage attachedTo(LimitUsageRepository repository) {
        InMemoryLimitUsage store = new InMemoryLimitUsage();

        when(repository.findByAccountIdAndWindowAndWindowStart(anyString(), any(), any(Instant.class)))
                .thenAnswer(call -> Optional.ofNullable(store.rows.get(
                        key(call.getArgument(0), call.getArgument(1), call.getArgument(2)))));

        when(repository.save(any(LimitUsage.class))).thenAnswer(call -> {
            LimitUsage usage = call.getArgument(0);
            store.rows.put(key(usage.getAccountId(), usage.getWindow(), usage.getWindowStart()), usage);
            return usage;
        });

        return store;
    }

    /** Seeds a bucket the way a previous day's holds would have. */
    public LimitUsage seed(String accountId, LimitWindow window, Instant bucket, long usedMinor, Currency currency) {
        LimitUsage usage = LimitUsage.opening(accountId, window, bucket, currency);
        if (usedMinor > 0) {
            usage.add(usedMinor);
        }
        rows.put(key(accountId, window, bucket), usage);
        return usage;
    }

    /** Committed value in the bucket containing {@code at}. */
    public long used(String accountId, LimitWindow window, Instant at) {
        LimitUsage usage = rows.get(key(accountId, window, window.startOf(at)));
        return usage == null ? 0L : usage.getUsedMinor();
    }

    /**
     * Committed value across every bucket of that window.
     *
     * <p>Used by tests that must not depend on which calendar day they run in: a
     * single scenario only ever writes one bucket per window, so the total is the
     * same number as {@link #used} without the midnight edge case.
     */
    public long totalUsed(String accountId, LimitWindow window) {
        return rows.values().stream()
                .filter(usage -> usage.getAccountId().equals(accountId) && usage.getWindow() == window)
                .mapToLong(LimitUsage::getUsedMinor)
                .sum();
    }

    private static String key(String accountId, LimitWindow window, Instant windowStart) {
        return accountId + '|' + window + '|' + windowStart;
    }
}
