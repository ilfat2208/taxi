package kz.taxi.order.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderItem;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.infrastructure.CustomerOrderRepository;
import kz.taxi.order.infrastructure.OrderItemRepository;
import kz.taxi.order.infrastructure.OrderPaymentRepository;
import kz.taxi.order.infrastructure.OrderStatusHistoryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * The read paths and who may use them.
 *
 * <p>An order id is not a secret, so the access rule is tested directly: a stranger
 * gets 403 (not 404, and definitely not the order), and an operator gets in.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OrderQueryServiceTest {

    private static final String USER_ID = OrderFixtures.USER_ID;

    @Mock
    private CustomerOrderRepository orderRepository;
    @Mock
    private OrderItemRepository orderItemRepository;
    @Mock
    private OrderStatusHistoryRepository historyRepository;
    @Mock
    private OrderPaymentRepository paymentRepository;

    private OrderQueryService queryService;
    private CustomerOrder order;

    @BeforeEach
    void setUp() {
        queryService = new OrderQueryService(orderRepository, orderItemRepository, historyRepository,
                paymentRepository, new OrderMapper());
        order = OrderFixtures.pendingOrder(USER_ID);
        when(orderRepository.findById(order.getId())).thenReturn(Optional.of(order));
        when(orderItemRepository.findByOrderIdOrderByIdAsc(order.getId()))
                .thenReturn(List.of(OrderFixtures.orderItem(order.getId(), "product-1", 5_000L, 2)));
        when(historyRepository.findByOrderIdOrderByCreatedAtAsc(order.getId()))
                .thenReturn(List.of(OrderStatusHistory.of(order.getId(), null, OrderStatus.PENDING_PAYMENT,
                        "checkout started", OrderStatusHistory.ACTOR_CUSTOMER)));
    }

    private static AuthenticatedUser user(String userId, String... roles) {
        return new AuthenticatedUser(userId, "+77000000000", "Someone", Set.of(roles));
    }

    @Test
    @DisplayName("the owner reads their order with its lines and its history")
    void ownerReadsTheOrder() {
        OrderDtos.OrderResponse response = queryService.getOrder(order.getId(), user(USER_ID, "CUSTOMER"));

        assertThat(response.orderNumber()).isEqualTo(order.getOrderNumber());
        assertThat(response.items()).hasSize(1);
        assertThat(response.history()).hasSize(1);
        assertThat(response.itemCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("an operator can read any order")
    void adminReadsAnyOrder() {
        OrderDtos.OrderResponse response = queryService.getOrder(order.getId(),
                user("operator-1", "ADMIN"));

        assertThat(response.orderId()).isEqualTo(order.getId());
    }

    @Test
    @DisplayName("a stranger gets 403 rather than somebody else's order")
    void strangerIsForbidden() {
        assertThatThrownBy(() -> queryService.getOrder(order.getId(), user(OrderFixtures.OTHER_USER_ID, "CUSTOMER")))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode().code())
                .isEqualTo("FORBIDDEN");
    }

    @Test
    @DisplayName("an unknown order is a 404 with its id in the details")
    void unknownOrderIsNotFound() {
        when(orderRepository.findById("nope")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> queryService.getOrder("nope", user(USER_ID, "CUSTOMER")))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.ORDER_NOT_FOUND);
    }

    @Test
    @DisplayName("the history of somebody else's order is not readable either")
    void historyIsProtectedToo() {
        assertThatThrownBy(() -> queryService.history(order.getId(),
                user(OrderFixtures.OTHER_USER_ID, "CUSTOMER")))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode().code())
                .isEqualTo("FORBIDDEN");
    }

    @Test
    @DisplayName("the order list is a page of summaries with one line-count query")
    void listsOrdersWithLineCounts() {
        Page<CustomerOrder> page = new PageImpl<>(List.of(order), PageRequest.of(0, 20), 1);
        when(orderRepository.findByUserIdOrderByCreatedAtDesc(USER_ID, PageRequest.of(0, 20))).thenReturn(page);
        when(orderItemRepository.countByOrderIds(any()))
                .thenReturn(List.<Object[]>of(new Object[]{order.getId(), 3L}));

        PageResponse<OrderDtos.OrderSummaryResponse> response =
                queryService.listOrders(USER_ID, null, PageRequest.of(0, 20));

        assertThat(response.totalElements()).isEqualTo(1);
        assertThat(response.items()).hasSize(1);
        assertThat(response.items().get(0).itemCount()).isEqualTo(3);
        assertThat(response.items().get(0).totalMinor()).isEqualTo(order.getTotalMinor());
    }

    @Test
    @DisplayName("a status filter goes to the database, not to memory")
    void filtersByStatus() {
        Page<CustomerOrder> page = new PageImpl<>(List.of(order), PageRequest.of(0, 20), 1);
        when(orderRepository.findByUserIdAndStatusOrderByCreatedAtDesc(eq(USER_ID),
                eq(OrderStatus.PENDING_PAYMENT), any())).thenReturn(page);
        when(orderItemRepository.countByOrderIds(any())).thenReturn(List.of());

        PageResponse<OrderDtos.OrderSummaryResponse> response =
                queryService.listOrders(USER_ID, OrderStatus.PENDING_PAYMENT, PageRequest.of(0, 20));

        assertThat(response.items()).hasSize(1);
        assertThat(response.items().get(0).itemCount()).isZero();
    }
}
