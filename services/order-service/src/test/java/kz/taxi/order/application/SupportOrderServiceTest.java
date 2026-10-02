package kz.taxi.order.application;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.SupportAuditRecord;
import kz.taxi.order.domain.SupportResourceType;
import kz.taxi.order.infrastructure.CustomerOrderRepository;
import kz.taxi.order.infrastructure.OrderItemRepository;
import kz.taxi.order.infrastructure.OrderPaymentRepository;
import kz.taxi.order.infrastructure.OrderStatusHistoryRepository;
import kz.taxi.order.infrastructure.SupportAuditRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The support read paths of the order service: what an agent may see of somebody
 * else's orders, and what the audit trail records about it.
 *
 * <p>The audit assertions are the point of this class. A support read that returned
 * data must leave <strong>exactly one</strong> row naming the actor and the resource,
 * and an unknown order must leave none — an audit table that also records failed
 * probes fills up with guesses and stops being evidence.
 */
class SupportOrderServiceTest {

    private static final String ACTOR = "agent-7";
    private static final String CORRELATION_ID = "corr-support-2";

    private CustomerOrderRepository orders;
    private OrderItemRepository orderItems;
    private OrderStatusHistoryRepository history;
    private OrderPaymentRepository payments;
    private SupportAuditRepository auditRepository;
    private SimpleMeterRegistry registry;
    private SupportOrderService service;

    private CustomerOrder order;

    @BeforeEach
    void setUp() {
        orders = mock(CustomerOrderRepository.class);
        orderItems = mock(OrderItemRepository.class);
        history = mock(OrderStatusHistoryRepository.class);
        payments = mock(OrderPaymentRepository.class);
        auditRepository = mock(SupportAuditRepository.class);
        registry = new SimpleMeterRegistry();
        service = new SupportOrderService(orders, orderItems, history, payments, new OrderMapper(),
                new SupportAuditService(auditRepository), new SupportMetrics(registry));
        CorrelationContext.set(CORRELATION_ID);

        // Somebody else's order: the actor is a support agent, not the owner.
        order = OrderFixtures.pendingOrder(OrderFixtures.OTHER_USER_ID);
        when(orders.findById(order.getId())).thenReturn(Optional.of(order));
        when(orderItems.findByOrderIdOrderByIdAsc(order.getId()))
                .thenReturn(List.of(OrderFixtures.orderItem(order.getId(), "product-1", 5_000L, 2)));
        when(history.findByOrderIdOrderByCreatedAtAsc(order.getId())).thenReturn(List.of(
                OrderStatusHistory.of(order.getId(), null, OrderStatus.PENDING_PAYMENT,
                        "checkout started", OrderStatusHistory.ACTOR_CUSTOMER)));
    }

    @AfterEach
    void tearDown() {
        CorrelationContext.clear();
        registry.close();
    }

    @Test
    @DisplayName("support reads a stranger's order and the trail names who, what and when")
    void supportReadsAStrangersOrderAndAuditsIt() {
        OrderDtos.OrderResponse response = service.orderById(order.getId(), ACTOR);

        assertThat(response.orderNumber()).isEqualTo(order.getOrderNumber());
        assertThat(response.items()).hasSize(1);
        assertThat(response.history()).hasSize(1);
        assertThat(response.itemCount()).isEqualTo(2);

        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getActorUserId()).isEqualTo(ACTOR);
        assertThat(row.getAction()).isEqualTo("order.support.order.read");
        assertThat(row.getEndpoint()).isEqualTo("GET /api/v1/support/orders/{orderId}");
        assertThat(row.getResourceType()).isEqualTo(SupportResourceType.ORDER.name());
        assertThat(row.getResourceId()).isEqualTo(order.getId());
        assertThat(row.getCorrelationId()).isEqualTo(CORRELATION_ID);
        assertThat(row.getCreatedAt()).isNotNull();

        assertThat(registry.get(SupportMetrics.SUPPORT_READ).tag("resource", "ORDER").counter().count())
                .isEqualTo(1d);
    }

    @Test
    @DisplayName("an order is found by the number the customer quotes, and the row names the order id")
    void anOrderIsFoundByTheNumberTheCustomerQuotes() {
        when(orders.findByOrderNumber(order.getOrderNumber())).thenReturn(Optional.of(order));

        OrderDtos.OrderResponse response = service.orderByNumber(order.getOrderNumber(), ACTOR);

        assertThat(response.orderId()).isEqualTo(order.getId());
        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getAction()).isEqualTo("order.support.order.by-number");
        // What was read is the order, not the number that was typed to find it.
        assertThat(row.getResourceId()).isEqualTo(order.getId());
    }

    @Test
    @DisplayName("orders are listed by user id, by status and unfiltered, and the trail says which")
    void ordersAreListedByUserAndByStatusAndTheAuditSaysWhich() {
        Page<CustomerOrder> page = new PageImpl<>(List.of(order), PageRequest.of(0, 20), 1);
        when(orders.findByUserIdOrderByCreatedAtDesc(eq(OrderFixtures.USER_ID), any(Pageable.class)))
                .thenReturn(page);
        when(orders.findByUserIdAndStatusOrderByCreatedAtDesc(eq(OrderFixtures.USER_ID),
                eq(OrderStatus.PENDING_PAYMENT), any(Pageable.class))).thenReturn(page);
        when(orders.findByStatusOrderByCreatedAtDesc(eq(OrderStatus.PENDING_PAYMENT), any(Pageable.class)))
                .thenReturn(page);
        when(orders.findAll(any(Pageable.class))).thenReturn(page);
        when(orderItems.countByOrderIds(any()))
                .thenReturn(List.<Object[]>of(new Object[]{order.getId(), 3L}));

        PageResponse<OrderDtos.OrderSummaryResponse> byUser =
                service.listOrders(OrderFixtures.USER_ID, null, 0, 20, ACTOR);
        PageResponse<OrderDtos.OrderSummaryResponse> byUserAndStatus =
                service.listOrders(OrderFixtures.USER_ID, OrderStatus.PENDING_PAYMENT, 0, 20, ACTOR);
        PageResponse<OrderDtos.OrderSummaryResponse> byStatus =
                service.listOrders(null, OrderStatus.PENDING_PAYMENT, 0, 20, ACTOR);
        PageResponse<OrderDtos.OrderSummaryResponse> unfiltered =
                service.listOrders("  ", null, 0, 20, ACTOR);

        // The line count comes from one grouped query, not one per row.
        assertThat(byUser.items()).singleElement()
                .satisfies(summary -> assertThat(summary.itemCount()).isEqualTo(3));
        assertThat(byStatus.items()).hasSize(1);
        assertThat(unfiltered.items()).hasSize(1);

        ArgumentCaptor<SupportAuditRecord> captor = ArgumentCaptor.forClass(SupportAuditRecord.class);
        verify(auditRepository, times(4)).save(captor.capture());
        assertThat(captor.getAllValues()).extracting(SupportAuditRecord::getResourceId)
                .containsExactly(OrderFixtures.USER_ID, OrderFixtures.USER_ID,
                        OrderStatus.PENDING_PAYMENT.name(), SupportAuditRecord.RESOURCE_ALL);
        assertThat(captor.getAllValues()).allSatisfy(row -> {
            assertThat(row.getActorUserId()).isEqualTo(ACTOR);
            assertThat(row.getAction()).isEqualTo("order.support.order.list");
            assertThat(row.getResourceType()).isEqualTo(SupportResourceType.ORDER.name());
        });
        assertThat(byUserAndStatus.items()).hasSize(1);
    }

    @Test
    @DisplayName("an unknown order id or number is a 404 and leaves no audit row")
    void anUnknownOrderIsNotFoundAndWritesNoAuditRow() {
        when(orders.findById("nope")).thenReturn(Optional.empty());
        when(orders.findByOrderNumber("ORD-404")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.orderById("nope", ACTOR))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode()).isEqualTo(OrderErrorCode.ORDER_NOT_FOUND));
        assertThatThrownBy(() -> service.orderByNumber("ORD-404", ACTOR))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode()).isEqualTo(OrderErrorCode.ORDER_NOT_FOUND));

        // Nothing was handed out, so nothing is recorded: no row, no metric.
        verify(auditRepository, never()).save(any());
        assertThat(registry.find(SupportMetrics.SUPPORT_READ).counters()).isEmpty();
    }

    @Test
    @DisplayName("the saga trail of somebody else's order is readable for support and audited as such")
    void theSagaTrailIsReadForSupportAndAudited() {
        List<OrderDtos.OrderHistoryResponse> trail = service.history(order.getId(), ACTOR);

        assertThat(trail).singleElement().satisfies(step -> {
            assertThat(step.toStatus()).isEqualTo(OrderStatus.PENDING_PAYMENT.name());
            assertThat(step.actor()).isEqualTo(OrderStatusHistory.ACTOR_CUSTOMER);
        });

        SupportAuditRecord row = theSingleAuditRow();
        assertThat(row.getAction()).isEqualTo("order.support.order-history.read");
        assertThat(row.getResourceType()).isEqualTo(SupportResourceType.ORDER_HISTORY.name());
        assertThat(row.getResourceId()).isEqualTo(order.getId());
        assertThat(registry.get(SupportMetrics.SUPPORT_READ).tag("resource", "ORDER_HISTORY").counter().count())
                .isEqualTo(1d);
    }

    private SupportAuditRecord theSingleAuditRow() {
        ArgumentCaptor<SupportAuditRecord> captor = ArgumentCaptor.forClass(SupportAuditRecord.class);
        verify(auditRepository).save(captor.capture());
        return captor.getValue();
    }
}
