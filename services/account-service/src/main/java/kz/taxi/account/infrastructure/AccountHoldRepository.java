package kz.taxi.account.infrastructure;

import jakarta.persistence.LockModeType;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.HoldStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AccountHoldRepository extends JpaRepository<AccountHold, String> {

    /** Idempotency lookup: the same client key must never reserve money twice. */
    Optional<AccountHold> findByIdempotencyKey(String idempotencyKey);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select h from AccountHold h where h.id = :id")
    Optional<AccountHold> findByIdForUpdate(@Param("id") String id);

    Page<AccountHold> findByAccountIdOrderByCreatedAtDesc(String accountId, Pageable pageable);

    Page<AccountHold> findByAccountIdAndStatusOrderByCreatedAtDesc(String accountId, HoldStatus status, Pageable pageable);

    Optional<AccountHold> findFirstByReferenceTypeAndReferenceIdAndAccountIdAndStatus(
            String referenceType, String referenceId, String accountId, HoldStatus status);

    /** Holds nobody ever finished — the cleanup job releases their funds. */
    List<AccountHold> findByStatusAndExpiresAtBefore(HoldStatus status, Instant threshold, Pageable pageable);

    /**
     * Velocity probe: how many outgoing operations this account started recently.
     *
     * <p>Counts every hold placed in the window regardless of its current status.
     * A released hold is still evidence that someone tried to move money, and
     * refunding the velocity budget on release would let an attacker loop forever
     * — which is precisely the card-testing pattern this check exists to stop.
     */
    long countByAccountIdAndCreatedAtAfter(String accountId, Instant threshold);
}
