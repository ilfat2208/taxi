package kz.taxi.account.infrastructure;

import kz.taxi.account.domain.LimitUsage;
import kz.taxi.account.domain.LimitWindow;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;

/**
 * Committed-value counters per (account, window, bucket).
 *
 * <p>Lookups are always by the full bucket key, which the unique index
 * {@code uq_limit_usage_bucket} serves directly — the enforcement path must not
 * need a range scan while the account row is locked.
 */
public interface LimitUsageRepository extends JpaRepository<LimitUsage, String> {

    Optional<LimitUsage> findByAccountIdAndWindowAndWindowStart(String accountId,
                                                                LimitWindow window,
                                                                Instant windowStart);
}
