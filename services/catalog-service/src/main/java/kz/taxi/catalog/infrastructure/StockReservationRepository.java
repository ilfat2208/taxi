package kz.taxi.catalog.infrastructure;

import jakarta.persistence.LockModeType;
import kz.taxi.catalog.domain.ReservationStatus;
import kz.taxi.catalog.domain.StockReservation;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface StockReservationRepository extends JpaRepository<StockReservation, String> {

    /** Idempotency probe: all holds of an order, in a stable order. */
    List<StockReservation> findByOrderIdOrderByProductIdAsc(String orderId);

    /**
     * The holds of one product, newest first — what support reads when the answer to
     * "why is there nothing left to buy" is "another checkout is sitting on it".
     *
     * <p>Takes a {@link Pageable} because this list is unbounded in a popular offer:
     * the caller asks for the most recent holds, not for all of them.
     */
    List<StockReservation> findByProductIdOrderByCreatedAtDesc(String productId, Pageable pageable);

    /**
     * Locks all holds of an order before they are committed or released.
     *
     * <p>Ordered by product id so that the reservation locks and the stock locks
     * taken afterwards are always acquired in the same sequence (see
     * {@link StockRepository#lockAllByProductIdIn}).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from StockReservation r where r.orderId = :orderId order by r.productId asc")
    List<StockReservation> lockByOrderId(@Param("orderId") String orderId);

    /**
     * Overdue holds, for the expiry job.
     *
     * <p>Scanned oldest-expiry-first but locked in product-id order, because the
     * stock rows are locked right after: a consistent acquisition order across
     * all transactions is what keeps the expiry job from deadlocking against a
     * concurrent checkout.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select r from StockReservation r
            where r.status = :status
              and r.expiresAt is not null
              and r.expiresAt < :now
            order by r.productId asc, r.expiresAt asc
            """)
    List<StockReservation> lockOverdue(@Param("status") ReservationStatus status, @Param("now") Instant now);
}
