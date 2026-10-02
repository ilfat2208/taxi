package kz.taxi.order.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.application.SupportOrderService;
import kz.taxi.order.domain.OrderStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Read-only support access to other people's orders.
 *
 * <p>The {@code SUPPORT} role exists in the platform's JWT precisely for this: an
 * agent who must explain an order to the customer who owns it without being handed
 * admin rights. Every endpoint here is a GET — the cancellation endpoint lives in
 * {@link OrderController} and is deliberately not reachable through this class, so
 * "support read something" and "support changed something" can never be confused.
 *
 * <p>The actor comes from the token ({@code currentUser}), never from a request
 * parameter, and every call is audited in {@code SupportOrderService}: who read whose
 * orders, and under which correlation id.
 */
@RestController
@RequestMapping("/api/v1/support/orders")
@PreAuthorize("hasAnyRole('SUPPORT','ADMIN')")
@Tag(name = "Support", description = "Read-only operator access to orders; every call is audited")
public class SupportOrderController {

    private final SupportOrderService support;
    private final CurrentUser currentUser;

    public SupportOrderController(SupportOrderService support, CurrentUser currentUser) {
        this.support = support;
        this.currentUser = currentUser;
    }

    @GetMapping("/{orderId}")
    @Operation(summary = "One order by id, with its lines and status history",
            description = "The owner-facing shape, served to an operator: an order id is never a secret here, "
                    + "but reading it for somebody else is recorded in the audit trail.")
    public OrderDtos.OrderResponse orderById(@PathVariable String orderId) {
        return support.orderById(orderId, currentUser.requireUserId());
    }

    @GetMapping("/by-number/{orderNumber}")
    @Operation(summary = "One order by the number the customer quotes",
            description = "404 ORDER_NOT_FOUND when no order carries that number.")
    public OrderDtos.OrderResponse orderByNumber(@PathVariable String orderNumber) {
        return support.orderByNumber(orderNumber, currentUser.requireUserId());
    }

    @GetMapping
    @Operation(summary = "Orders by user id and/or status, newest first",
            description = "Both filters are optional. The audit row records which one was used: the user id, "
                    + "otherwise the status, otherwise 'ALL' for an unfiltered scan.")
    public PageResponse<OrderDtos.OrderSummaryResponse> list(
            @Parameter(description = "Identity-service user id whose orders to read")
            @RequestParam(required = false) String userId,
            @Parameter(description = "Filter by order status")
            @RequestParam(required = false) OrderStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return support.listOrders(userId, status, page, size, currentUser.requireUserId());
    }

    @GetMapping("/{orderId}/history")
    @Operation(summary = "The saga trail of one order, oldest first",
            description = "Every transition, who caused it and why — the first thing to read when an order looks "
                    + "wrong, and what an agent needs before promising a customer anything.")
    public List<OrderDtos.OrderHistoryResponse> history(@PathVariable String orderId) {
        return support.history(orderId, currentUser.requireUserId());
    }
}
