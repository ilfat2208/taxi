package kz.taxi.payment.infrastructure;

import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.domain.RefundStatus;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface RefundRepository extends JpaRepository<Refund, String> {

    /** The retry path: the same {@code Idempotency-Key} must find the refund it already created. */
    Optional<Refund> findByIdempotencyKey(String idempotencyKey);

    List<Refund> findByPaymentIdOrderByCreatedAtAsc(String paymentId);

    /**
     * Everything already refunded on a payment, ignoring failed attempts.
     *
     * <p>Only refunds that did not move money are excluded: a refund whose credit
     * failed consumed none of the payment's refundable amount, while an
     * {@code INITIATED} one is on its way to being paid and must already count —
     * otherwise two concurrent partial refunds could each pass the limit check.
     */
    @Query("""
            select coalesce(sum(r.amountMinor), 0) from Refund r
            where r.paymentId = :paymentId
              and r.status <> kz.taxi.payment.domain.RefundStatus.FAILED
            """)
    long sumRefunded(@Param("paymentId") String paymentId);

    /** Refunds that were created but whose credit never reported back. */
    List<Refund> findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(RefundStatus status, Instant threshold,
                                                                   Pageable pageable);
}
