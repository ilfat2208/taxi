package kz.taxi.order.infrastructure;

import kz.taxi.order.domain.OrderItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface OrderItemRepository extends JpaRepository<OrderItem, String> {

    List<OrderItem> findByOrderIdOrderByIdAsc(String orderId);

    /** Line count of one order, for the {@code itemCount} of a published event. */
    long countByOrderId(String orderId);

    /**
     * Line counts for a whole page of orders.
     *
     * <p>One grouped query instead of one count per row: an order list with an
     * N+1 problem is a page that gets slower with every order a customer makes.
     *
     * @return rows of {@code [orderId, count]}
     */
    @Query("select i.orderId, count(i) from OrderItem i where i.orderId in :orderIds group by i.orderId")
    List<Object[]> countByOrderIds(@Param("orderIds") Collection<String> orderIds);
}
