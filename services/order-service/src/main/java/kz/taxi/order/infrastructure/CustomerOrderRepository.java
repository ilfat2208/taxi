package kz.taxi.order.infrastructure;

import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.domain.SagaState;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CustomerOrderRepository extends JpaRepository<CustomerOrder, String> {

    Optional<CustomerOrder> findByIdempotencyKey(String idempotencyKey);

    /**
     * Finds an order by the human-readable number, which is what a customer quotes
     * to support. {@code uq_order_number} makes this a single-row lookup.
     */
    Optional<CustomerOrder> findByOrderNumber(String orderNumber);

    /**
     * Finds the order of a payment when the event or the caller did not name it.
     *
     * <p>The payment service's {@code payment.completed} payload is expected to carry
     * the order id; this is the fallback that keeps a schema drift from losing an
     * event.
     */
    Optional<CustomerOrder> findFirstByPaymentId(String paymentId);

    Page<CustomerOrder> findByUserIdOrderByCreatedAtDesc(String userId, Pageable pageable);

    Page<CustomerOrder> findByUserIdAndStatusOrderByCreatedAtDesc(String userId, OrderStatus status, Pageable pageable);

    /**
     * Orders in one state, newest first.
     *
     * <p>Support reads this when the question is about the state itself ("everything
     * stuck in PENDING_PAYMENT") rather than about a person.
     */
    Page<CustomerOrder> findByStatusOrderByCreatedAtDesc(OrderStatus status, Pageable pageable);

    /** Number of orders created since midnight: the readable part of the order number. */
    long countByCreatedAtGreaterThanEqual(Instant since);

    /**
     * Orders that have not moved for a while, oldest first.
     *
     * <p>Ordered by {@code updatedAt} so a stuck order cannot be starved by a
     * constant stream of fresh ones, and limited so one bad batch cannot fill memory.
     */
    @Query("select o from CustomerOrder o where o.status = :status and o.updatedAt < :before order by o.updatedAt asc")
    List<CustomerOrder> findStuck(@Param("status") OrderStatus status,
                                  @Param("before") Instant before,
                                  Pageable pageable);

    /** Orders whose saga still owes a compensation or a commit. */
    @Query("select o from CustomerOrder o where o.sagaState in :states and o.updatedAt < :before "
            + "order by o.updatedAt asc")
    List<CustomerOrder> findInSagaStates(@Param("states") Collection<SagaState> states,
                                         @Param("before") Instant before,
                                         Pageable pageable);

    /**
     * Loads an order with a row lock.
     *
     * <p>The synchronous saga, the Kafka listener, the cancel endpoint and the
     * recovery job can all reach the same order. A pessimistic lock serialises them
     * so two of them cannot both decide they are the one that finalises it — which
     * would publish two {@code order.paid} events and commit the stock twice.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from CustomerOrder o where o.id = :id")
    Optional<CustomerOrder> findByIdForUpdate(@Param("id") String id);
}
