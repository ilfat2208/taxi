package kz.taxi.order.infrastructure;

import kz.taxi.order.domain.OrderStatusHistory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OrderStatusHistoryRepository extends JpaRepository<OrderStatusHistory, String> {

    List<OrderStatusHistory> findByOrderIdOrderByCreatedAtAsc(String orderId);
}
