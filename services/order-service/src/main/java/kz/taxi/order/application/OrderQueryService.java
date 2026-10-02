package kz.taxi.order.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.infrastructure.CustomerOrderRepository;
import kz.taxi.order.infrastructure.OrderItemRepository;
import kz.taxi.order.infrastructure.OrderPaymentRepository;
import kz.taxi.order.infrastructure.OrderStatusHistoryRepository;
import kz.taxi.common.security.AuthenticatedUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Every read path of the order API.
 *
 * <p>Authorization lives here rather than in the controllers: "may this caller see
 * this order" is a business rule, and one place is what keeps a new endpoint from
 * forgetting it. A caller who is not the owner and not an operator gets a 403, not
 * a 404: this service does not help anybody enumerate other people's orders, and an
 * order id alone is not a secret.
 */
@Service
public class OrderQueryService {

    private final CustomerOrderRepository orderRepository;
    private final OrderItemRepository orderItemRepository;
    private final OrderStatusHistoryRepository historyRepository;
    private final OrderPaymentRepository paymentRepository;
    private final OrderMapper mapper;

    public OrderQueryService(CustomerOrderRepository orderRepository,
                             OrderItemRepository orderItemRepository,
                             OrderStatusHistoryRepository historyRepository,
                             OrderPaymentRepository paymentRepository,
                             OrderMapper mapper) {
        this.orderRepository = orderRepository;
        this.orderItemRepository = orderItemRepository;
        this.historyRepository = historyRepository;
        this.paymentRepository = paymentRepository;
        this.mapper = mapper;
    }

    /** One order in full, without an access check: for the saga and the Kafka paths. */
    @Transactional(readOnly = true)
    public OrderDtos.OrderResponse loadOrderResponse(String orderId) {
        return mapper.toResponse(requireOrder(orderId),
                orderItemRepository.findByOrderIdOrderByIdAsc(orderId),
                paymentRepository.findByOrderIdOrderByMerchantIdAsc(orderId),
                historyRepository.findByOrderIdOrderByCreatedAtAsc(orderId));
    }

    @Transactional(readOnly = true)
    public OrderDtos.OrderResponse getOrder(String orderId, AuthenticatedUser requester) {
        CustomerOrder order = requireOrder(orderId);
        requireAccess(order, requester);
        return mapper.toResponse(order,
                orderItemRepository.findByOrderIdOrderByIdAsc(orderId),
                paymentRepository.findByOrderIdOrderByMerchantIdAsc(orderId),
                historyRepository.findByOrderIdOrderByCreatedAtAsc(orderId));
    }

    /** The saga's audit trail, oldest first: it reads like a story. */
    @Transactional(readOnly = true)
    public List<OrderDtos.OrderHistoryResponse> history(String orderId, AuthenticatedUser requester) {
        requireAccess(requireOrder(orderId), requester);
        return historyRepository.findByOrderIdOrderByCreatedAtAsc(orderId).stream()
                .map(mapper::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public PageResponse<OrderDtos.OrderSummaryResponse> listOrders(String userId,
                                                                  OrderStatus status,
                                                                  Pageable pageable) {
        Page<CustomerOrder> page = status == null
                ? orderRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                : orderRepository.findByUserIdAndStatusOrderByCreatedAtDesc(userId, status, pageable);

        Map<String, Integer> lineCounts = lineCountsOf(orderItemRepository, page.getContent());
        return PageResponse.of(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(),
                order -> mapper.toSummary(order, lineCounts.getOrDefault(order.getId(), 0)));
    }

    /** The caller's own order, or a 403 when it belongs to somebody else. */
    CustomerOrder requireOrder(String orderId) {
        return orderRepository.findById(orderId)
                .orElseThrow(() -> DomainException.of(OrderErrorCode.ORDER_NOT_FOUND,
                                "order {} not found", orderId)
                        .withDetail("orderId", orderId));
    }

    private static void requireAccess(CustomerOrder order, AuthenticatedUser requester) {
        if (requester == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!requester.canAccess(order.getUserId())) {
            throw DomainException.forbidden("order {} belongs to another user", order.getOrderNumber());
        }
    }

    /**
     * Line counts for a page of orders in one query.
     *
     * <p>The list is the most used endpoint of this service; a count per row would
     * make it the slowest one as well. Package-private and static so the support list
     * (a different audience, the same rows) reuses it instead of growing a second,
     * subtly different count.
     */
    static Map<String, Integer> lineCountsOf(OrderItemRepository orderItems, List<CustomerOrder> orders) {
        if (orders.isEmpty()) {
            return Map.of();
        }
        Collection<String> orderIds = orders.stream().map(CustomerOrder::getId).toList();
        Map<String, Integer> counts = new HashMap<>();
        for (Object[] row : orderItems.countByOrderIds(orderIds)) {
            counts.put((String) row[0], ((Number) row[1]).intValue());
        }
        return counts;
    }
}
