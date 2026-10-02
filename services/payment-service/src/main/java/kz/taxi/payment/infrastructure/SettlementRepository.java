package kz.taxi.payment.infrastructure;

import kz.taxi.payment.domain.MerchantSettlement;
import kz.taxi.payment.domain.SettlementStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface SettlementRepository extends JpaRepository<MerchantSettlement, String> {

    Optional<MerchantSettlement> findByIdempotencyKey(String idempotencyKey);

    Page<MerchantSettlement> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<MerchantSettlement> findByMerchantIdOrderByCreatedAtDesc(String merchantId, Pageable pageable);

    Page<MerchantSettlement> findByOwnerUserIdOrderByCreatedAtDesc(String ownerUserId, Pageable pageable);

    /**
     * Payout work queue: everything still owed to somebody, oldest first.
     *
     * <p>Locked with {@code SKIP LOCKED} for the same reason the outbox relay is:
     * several replicas may run the payout job, and each should take a different row
     * instead of waiting on the same one.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select s from MerchantSettlement s
            where s.status <> kz.taxi.payment.domain.SettlementStatus.PAID
            order by s.createdAt asc
            """)
    List<MerchantSettlement> findPayable(Pageable pageable);

    long countByStatus(SettlementStatus status);

    /**
     * Total still owed to merchants, in minor units.
     *
     * <p>Exposed as a metric: a number that only grows means payouts are broken, and
     * it is the fastest way to notice before a merchant calls.
     */
    @Query("""
            select coalesce(sum(s.netMinor), 0) from MerchantSettlement s
            where s.status <> kz.taxi.payment.domain.SettlementStatus.PAID
            """)
    long sumUnpaidNetMinor();

    /** Debt older than a threshold: "we owe it, and we have owed it for too long". */
    long countByStatusNotAndCreatedAtBefore(SettlementStatus status, Instant threshold);
}