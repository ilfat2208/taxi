package kz.taxi.catalog.infrastructure;

import jakarta.persistence.LockModeType;
import kz.taxi.catalog.domain.Stock;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * Stock access, locked.
 *
 * <p>Every read that may be followed by a write uses {@code PESSIMISTIC_WRITE}:
 * {@code SELECT ... FOR UPDATE} makes the second checkout of the last unit wait
 * for the first one to commit and then re-read the row, so it sees the reduced
 * availability instead of the stale value it would get from a plain read. This is
 * the mechanism that makes overselling impossible; the DB CHECK constraint is the
 * backstop if a future code path forgets the lock.
 */
public interface StockRepository extends JpaRepository<Stock, String> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Stock s where s.productId = :productId")
    Optional<Stock> lockByProductId(@Param("productId") String productId);

    /**
     * Locks several stock rows at once, <strong>ordered by product id</strong>.
     *
     * <p>The order is the whole point: two transactions that touch {A, B} must
     * acquire the locks in the same sequence, otherwise one holds A and waits for
     * B while the other holds B and waits for A — a deadlock. Sorting the ids
     * before locking in {@code StockReservationService} and sorting again here
     * makes every multi-row stock transaction deadlock-free by construction.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Stock s where s.productId in :productIds order by s.productId asc")
    List<Stock> lockAllByProductIdIn(@Param("productIds") Collection<String> productIds);
}
