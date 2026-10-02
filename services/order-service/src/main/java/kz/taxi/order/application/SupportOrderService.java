package kz.taxi.order.application;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.domain.SupportAction;
import kz.taxi.order.domain.SupportAuditRecord;
import kz.taxi.order.infrastructure.CustomerOrderRepository;
import kz.taxi.order.infrastructure.OrderItemRepository;
import kz.taxi.order.infrastructure.OrderPaymentRepository;
import kz.taxi.order.infrastructure.OrderStatusHistoryRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

/**
 * The read side support actually needs: somebody else's orders.
 *
 * <p>This service exists because the platform's JWT already carries a
 * {@code SUPPORT} role and {@code AuthenticatedUser.canAccess(owner)} already treats
 * it as "may see other people's data", but nothing served that use case — a support
 * agent had either admin rights or nothing. These reads are the missing middle:
 * strictly read-only (there is no cancel, no state change and no compensation here),
 * and <strong>every one of them leaves an audit row</strong>.
 *
 * <p>Two things about these methods are load-bearing and easy to break by accident:
 *
 * <ul>
 *   <li><strong>Not {@code readOnly}.</strong> Every method writes exactly one row
 *       into the audit trail through {@link SupportAuditService} and therefore needs
 *       a read-write transaction. Marking them {@code readOnly} would both fail the
 *       insert on Postgres and break the guarantee that the row commits with the
 *       read.</li>
 *   <li><strong>The audit call comes last.</strong> The order is loaded and mapped
 *       first, so an unknown id (404) never reaches the audit write: the trail
 *       records data that was handed out, not failed probes. Note that an
 *       <em>empty</em> order list is not a failure — "this customer has no orders" is
 *       a real answer, and it is audited as one.</li>
 * </ul>
 *
 * <p>The access rule itself is not re-implemented here: reaching these methods at all
 * requires {@code SUPPORT} or {@code ADMIN} (the controller's {@code @PreAuthorize}),
 * and the actor is taken from the token rather than from a request parameter, so the
 * audit row cannot name somebody who did not make the call.
 */
@Service
public class SupportOrderService {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final CustomerOrderRepository orders;
    private final OrderItemRepository orderItems;
    private final OrderStatusHistoryRepository history;
    private final OrderPaymentRepository payments;
    private final OrderMapper mapper;
    private final SupportAuditService audit;
    private final SupportMetrics metrics;

    public SupportOrderService(CustomerOrderRepository orders,
                               OrderItemRepository orderItems,
                               OrderStatusHistoryRepository history,
                               OrderPaymentRepository payments,
                               OrderMapper mapper,
                               SupportAuditService audit,
                               SupportMetrics metrics) {
        this.orders = orders;
        this.orderItems = orderItems;
        this.history = history;
        this.payments = payments;
        this.mapper = mapper;
        this.audit = audit;
        this.metrics = metrics;
    }

    /** One order in full — lines, totals and saga history. */
    @Transactional
    public OrderDtos.OrderResponse orderById(String orderId, String actorUserId) {
        CustomerOrder order = requireOrder(requireId(orderId, "orderId"));
        OrderDtos.OrderResponse response = fullOrder(order);
        audited(SupportAction.ORDER_READ, order.getId(), actorUserId);
        return response;
    }

    /**
     * One order by the number the customer reads out on the phone.
     *
     * <p>The audit row names the resolved order id, not the number that was typed:
     * the trail is about which order was read, and an order number is just a way to
     * find it.
     */
    @Transactional
    public OrderDtos.OrderResponse orderByNumber(String orderNumber, String actorUserId) {
        String number = requireId(orderNumber, "orderNumber");
        CustomerOrder order = orders.findByOrderNumber(number)
                .orElseThrow(() -> DomainException.of(OrderErrorCode.ORDER_NOT_FOUND,
                        "order {} not found", number).withDetail("orderNumber", number));
        OrderDtos.OrderResponse response = fullOrder(order);
        audited(SupportAction.ORDER_BY_NUMBER, order.getId(), actorUserId);
        return response;
    }

    /**
     * Orders by user id and/or status, newest first.
     *
     * <p>This is how a support conversation starts when the customer names a person
     * rather than an order. Both filters are optional and an unfiltered scan is
     * allowed (it is paged and clamped), but the audit row always says which one it
     * was: the user id when there is one, otherwise the status, otherwise
     * {@link SupportAuditRecord#RESOURCE_ALL} — so "who read the whole order table?"
     * is a question the log answers.
     */
    @Transactional
    public PageResponse<OrderDtos.OrderSummaryResponse> listOrders(String userId,
                                                                  OrderStatus status,
                                                                  int page,
                                                                  int size,
                                                                  String actorUserId) {
        String owner = userId == null || userId.isBlank() ? null : userId.trim();
        Pageable pageable = PageRequest.of(safePage(page), safeSize(size));

        Page<CustomerOrder> found;
        if (owner != null && status != null) {
            found = orders.findByUserIdAndStatusOrderByCreatedAtDesc(owner, status, pageable);
        } else if (owner != null) {
            found = orders.findByUserIdOrderByCreatedAtDesc(owner, pageable);
        } else if (status != null) {
            found = orders.findByStatusOrderByCreatedAtDesc(status, pageable);
        } else {
            found = orders.findAll(pageable);
        }

        Map<String, Integer> lineCounts = OrderQueryService.lineCountsOf(orderItems, found.getContent());
        audited(SupportAction.ORDER_LIST, collectionKey(owner, status), actorUserId);
        return PageResponse.of(found.getContent(), found.getNumber(), found.getSize(),
                found.getTotalElements(),
                order -> mapper.toSummary(order, lineCounts.getOrDefault(order.getId(), 0)));
    }

    /** The saga trail of one order, oldest first: every transition, who caused it and why. */
    @Transactional
    public List<OrderDtos.OrderHistoryResponse> history(String orderId, String actorUserId) {
        CustomerOrder order = requireOrder(requireId(orderId, "orderId"));
        List<OrderDtos.OrderHistoryResponse> response =
                history.findByOrderIdOrderByCreatedAtAsc(order.getId()).stream()
                        .map(mapper::toResponse)
                        .toList();
        audited(SupportAction.ORDER_HISTORY_READ, order.getId(), actorUserId);
        return response;
    }

    // ------------------------------------------------------------------ internals

    /** The single place where "this read happened" is recorded: audit row, then counter. */
    private void audited(SupportAction action, String resourceId, String actorUserId) {
        audit.append(action, resourceId, actorUserId);
        metrics.supportRead(action.resourceType());
    }

    private OrderDtos.OrderResponse fullOrder(CustomerOrder order) {
        return mapper.toResponse(order,
                orderItems.findByOrderIdOrderByIdAsc(order.getId()),
                payments.findByOrderIdOrderByMerchantIdAsc(order.getId()),
                history.findByOrderIdOrderByCreatedAtAsc(order.getId()));
    }

    /**
     * The key stored in the audit row for a list read.
     *
     * <p>The user id wins when present because that is the sensitive fact ("whose
     * orders were browsed"); a status-only scan is keyed by the status, and an
     * unfiltered one by {@code ALL}.
     */
    private static String collectionKey(String userId, OrderStatus status) {
        if (userId != null) {
            return userId;
        }
        return status == null ? SupportAuditRecord.RESOURCE_ALL : status.name();
    }

    private CustomerOrder requireOrder(String orderId) {
        return orders.findById(orderId)
                .orElseThrow(() -> DomainException.of(OrderErrorCode.ORDER_NOT_FOUND,
                        "order {} not found", orderId).withDetail("orderId", orderId));
    }

    private static int safePage(int page) {
        return Math.max(page, 0);
    }

    private static int safeSize(int size) {
        return size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }

    private static String requireId(String value, String name) {
        if (value == null || value.isBlank()) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED, "{} must not be blank", name)
                    .withDetail(name, value);
        }
        return value.trim();
    }
}
