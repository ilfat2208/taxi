package kz.taxi.account.infrastructure;

import kz.taxi.account.domain.LedgerDirection;
import kz.taxi.account.domain.LedgerEntry;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

/**
 * The ledger is append-only, so this repository deliberately has no update API
 * beyond what {@code JpaRepository} forces on us — and no code path calls
 * {@code delete} or {@code save} on an existing entry.
 */
public interface LedgerEntryRepository extends JpaRepository<LedgerEntry, String> {

    Page<LedgerEntry> findByAccountIdOrderByCreatedAtDesc(String accountId, Pageable pageable);

    List<LedgerEntry> findByTransactionIdOrderByCreatedAtAsc(String transactionId);

    /** Idempotency probe for reference-based credits: "have we already paid this out?". */
    boolean existsByReferenceTypeAndReferenceId(String referenceType, String referenceId);

    Optional<LedgerEntry> findFirstByReferenceTypeAndReferenceIdAndDirectionOrderByCreatedAtDesc(
            String referenceType, String referenceId, LedgerDirection direction);

    long countByAccountId(String accountId);

    /**
     * The ledger invariant as a query: for a healthy transaction this is zero.
     *
     * <p>Used by tests, by the reconciliation job and by anyone debugging a
     * balance dispute — it converts "the numbers look wrong" into a boolean.
     */
    @Query("""
            select coalesce(sum(case when e.direction = kz.taxi.account.domain.LedgerDirection.CREDIT
                                     then e.amountMinor else -e.amountMinor end), 0)
            from LedgerEntry e
            where e.transactionId = :transactionId
            """)
    long signedSumForTransaction(@Param("transactionId") String transactionId);
}
