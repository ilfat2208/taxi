package kz.taxi.account.infrastructure;

import jakarta.persistence.LockModeType;
import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountStatus;
import kz.taxi.account.domain.AccountType;
import kz.taxi.common.core.money.Currency;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * Accounts, with the locks that make concurrent money movement safe.
 *
 * <p>{@link #findByIdForUpdate} takes a row lock instead of relying on optimistic
 * locking. For a wallet that is the right trade-off: two simultaneous debits of
 * the same balance must be serialised, and failing fast with a retry ("try
 * again") is a worse experience than queueing behind a lock held for a few
 * milliseconds.
 */
public interface AccountRepository extends JpaRepository<Account, String> {

    List<Account> findByOwnerUserIdOrderByCreatedAtAsc(String ownerUserId);

    Optional<Account> findFirstByOwnerUserIdAndCurrencyAndTypeAndStatusNot(
            String ownerUserId, Currency currency, AccountType type, AccountStatus excludedStatus);

    Optional<Account> findFirstByOwnerPhoneAndCurrencyAndStatusOrderByCreatedAtAsc(
            String ownerPhone, Currency currency, AccountStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Account a where a.id = :id")
    Optional<Account> findByIdForUpdate(@Param("id") String id);

    /** The suspense account of a currency; created on demand by the seeder. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<Account> findFirstByTypeAndCurrencyAndStatus(AccountType type, Currency currency, AccountStatus status);

    boolean existsByOwnerUserIdAndCurrencyAndType(String ownerUserId, Currency currency, AccountType type);
}
