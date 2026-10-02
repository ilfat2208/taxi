package kz.taxi.account.infrastructure;

import kz.taxi.account.domain.AccountLimit;
import kz.taxi.account.domain.LimitWindow;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * Configured outgoing limits.
 *
 * <p>No pessimistic lock on purpose: every caller of the enforcement path holds
 * the account row lock already ({@code AccountRepository.findByIdForUpdate}),
 * which serialises all limit decisions for one account. Locking these rows too
 * would add a second lock ordering to reason about for no additional safety.
 */
public interface AccountLimitRepository extends JpaRepository<AccountLimit, String> {

    List<AccountLimit> findByAccountId(String accountId);

    Optional<AccountLimit> findByAccountIdAndWindow(String accountId, LimitWindow window);
}
