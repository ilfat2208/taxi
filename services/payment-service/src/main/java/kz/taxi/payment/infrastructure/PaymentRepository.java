package kz.taxi.payment.infrastructure;

import jakarta.persistence.LockModeType;
import kz.taxi.common.core.money.Currency;
import kz.taxi.payment.application.SettlementCandidate;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Payment persistence.
 *
 * <p>{@link #findByIdForUpdate} exists for the two places where two writers can
 * meet: taking a refund (the cumulative refund limit is only safe under a row
 * lock) and the recovery job (two replicas must not both decide a payment's
 * fate). Everything else relies on {@code @Version}.
 */
public interface PaymentRepository extends JpaRepository<Payment, String> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Payment p where p.id = :id")
    Optional<Payment> findByIdForUpdate(@Param("id") String id);

    Optional<Payment> findByIdempotencyKey(String idempotencyKey);

    /** Newest first: a retried merchant payment may have produced more than one row for an order. */
    List<Payment> findByOrderIdOrderByCreatedAtDesc(String orderId);

    /**
     * Ascending order: the order in which the saga paid the merchants, which is the
     * order a human reading the split expects to see.
     */
    List<Payment> findByOrderIdOrderByCreatedAtAsc(String orderId);

    Page<Payment> findByOwnerUserIdOrderByCreatedAtDesc(String ownerUserId, Pageable pageable);

    Page<Payment> findByOwnerUserIdAndStatusOrderByCreatedAtDesc(String ownerUserId, PaymentStatus status,
                                                                 Pageable pageable);

    Page<Payment> findByStatusOrderByCreatedAtDesc(PaymentStatus status, Pageable pageable);

    Page<Payment> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /**
     * Payments whose saga stopped: non-terminal and not touched for longer than the
     * configured threshold.
     *
     * <p>The query is deliberately unlocked and unsorted by priority — a short
     * selection transaction, then a separate locked transaction per payment, keeps
     * remote calls out of the database transaction.
     */
    @Query("""
            select p from Payment p
            where p.status in :statuses
              and p.updatedAt < :threshold
            order by p.updatedAt asc
            """)
    List<Payment> findStuck(@Param("statuses") Collection<PaymentStatus> statuses,
                            @Param("threshold") Instant threshold,
                            Pageable pageable);

    /**
     * Merchants (and currencies) that have sales old enough to settle.
     *
     * <p>{@code completedAt < cutoff} is the commercial rule, not a technical one:
     * money is held for a while after a sale so a refund can still be absorbed, and
     * only then becomes a payout. A transaction that groups by merchant+currency
     * means a settlement is always in one currency, which is what a bank transfer
     * actually requires.
     */
    @Query("""
            select new kz.taxi.payment.application.SettlementCandidate(p.merchantId, p.currency)
            from Payment p
            where p.status = kz.taxi.payment.domain.PaymentStatus.COMPLETED
              and p.type = kz.taxi.payment.domain.PaymentType.MERCHANT_PAYMENT
              and p.merchantId is not null
              and p.settledAt is null
              and p.completedAt < :cutoff
            group by p.merchantId, p.currency
            order by p.merchantId asc
            """)
    List<SettlementCandidate> findMerchantsWithUnsettledSales(@Param("cutoff") Instant cutoff, Pageable pageable);

    /**
     * The sales a settlement will cover, locked so two runs cannot include the same
     * payment in two different payouts.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select p from Payment p
            where p.status = kz.taxi.payment.domain.PaymentStatus.COMPLETED
              and p.type = kz.taxi.payment.domain.PaymentType.MERCHANT_PAYMENT
              and p.merchantId = :merchantId
              and p.currency = :currency
              and p.settledAt is null
              and p.completedAt < :cutoff
            order by p.completedAt asc
            """)
    List<Payment> findUnsettledSales(@Param("merchantId") String merchantId,
                                     @Param("currency") Currency currency,
                                     @Param("cutoff") Instant cutoff);
    /** Used by the open-payments gauge: a growing number means sagas are not finishing. */
    long countByStatus(PaymentStatus status);
}
