package kz.taxi.order.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.web.idempotency.IdempotencyContext;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.application.CheckoutSagaService;
import kz.taxi.order.application.OrderQueryService;
import kz.taxi.order.domain.OrderStatus;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Customer order API: checkout, cancellation and the reads that explain both.
 *
 * <p>The controller decides nothing: the saga owns the orchestration, the query
 * service owns the access rules, and the HTTP status comes from the error code the
 * use case raised (see the platform's {@code GlobalExceptionHandler}).
 */
@RestController
@RequestMapping("/api/v1/orders")
@Tag(name = "Orders", description = "Checkout saga, cancellation and order history")
public class OrderController {

    private static final int MAX_PAGE_SIZE = 100;

    private final CheckoutSagaService checkoutSaga;
    private final OrderQueryService orderQueryService;
    private final CurrentUser currentUser;

    public OrderController(CheckoutSagaService checkoutSaga,
                           OrderQueryService orderQueryService,
                           CurrentUser currentUser) {
        this.checkoutSaga = checkoutSaga;
        this.orderQueryService = orderQueryService;
        this.currentUser = currentUser;
    }

    /**
     * Starts a checkout.
     *
     * <p>{@code 201} when the order reached a final state, {@code 202} when the
     * payment outcome is not known yet — the body carries the order either way, and
     * {@code GET /orders/{id}} is how the client learns the rest. Business refusals
     * are errors with the cancelled order's id in the details: no stock is a 409
     * {@code PRODUCT_UNAVAILABLE}, a declined card a 422 {@code PAYMENT_DECLINED}.
     */
    @PostMapping
    @Operation(summary = "Check out the cart",
            description = "Requires the Idempotency-Key header. Creates the order, reserves stock in the catalog, "
                    + "charges the merchant payment and settles: PAID on success, CANCELLED with a reason on a "
                    + "business refusal, still PENDING_PAYMENT (202) when the payment outcome is unknown. "
                    + "A replay of the same key returns the same answer and never creates a second order.")
    public ResponseEntity<OrderDtos.OrderResponse> checkout(@Valid @RequestBody OrderDtos.CheckoutRequest request) {
        String idempotencyKey = IdempotencyGuard.requireKey();
        CheckoutSagaService.CheckoutResult result =
                checkoutSaga.checkout(request, idempotencyKey, currentUser.requireUserId());
        HttpStatus status = result.awaitingPaymentOutcome() ? HttpStatus.ACCEPTED : HttpStatus.CREATED;
        return ResponseEntity.status(status).body(result.order());
    }

    /**
     * Cancels an order.
     *
     * <p>{@code Idempotency-Key} is honoured when present but not required: the
     * cancellation is idempotent by the order state machine, and the refund it may
     * trigger is idempotent by a key derived from the order id.
     */
    @PostMapping("/{orderId}/cancel")
    @Operation(summary = "Cancel an order",
            description = "Allowed while DRAFT/PENDING_PAYMENT. Releases the stock hold, refunds the payment if it "
                    + "was already captured, and publishes order.cancelled. Cancelling an already cancelled order "
                    + "returns 200 with its current state; a PAID or CONFIRMED order is 409 ORDER_NOT_CANCELLABLE, "
                    + "and an unknown payment outcome is 409 PAYMENT_PENDING (nothing is changed).")
    public OrderDtos.OrderResponse cancel(@PathVariable String orderId,
                                         @RequestBody(required = false) OrderDtos.CancelOrderRequest request) {
        String reason = request == null ? null : request.reason();
        return checkoutSaga.cancel(orderId, reason, currentUser.require(), IdempotencyContext.optional());
    }

    @GetMapping
    @Operation(summary = "List the caller's orders, newest first")
    public PageResponse<OrderDtos.OrderSummaryResponse> list(
            @Parameter(description = "Zero-based page index") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size, 1..100") @RequestParam(defaultValue = "20") int size,
            @Parameter(description = "Filter by order status") @RequestParam(required = false) OrderStatus status) {

        Pageable pageable = PageRequest.of(Math.max(page, 0), clamp(size));
        return orderQueryService.listOrders(currentUser.requireUserId(), status, pageable);
    }

    @GetMapping("/{orderId}")
    @Operation(summary = "Get one order with its lines and status history",
            description = "The owner, or support/ADMIN. Anybody else gets 403.")
    public OrderDtos.OrderResponse get(@PathVariable String orderId) {
        return orderQueryService.getOrder(orderId, currentUser.require());
    }

    @GetMapping("/{orderId}/history")
    @Operation(summary = "The saga trail of an order, oldest first",
            description = "Every transition, who caused it and why — the first thing to read when an order looks "
                    + "wrong.")
    public List<OrderDtos.OrderHistoryResponse> history(@PathVariable String orderId) {
        return orderQueryService.history(orderId, currentUser.require());
    }

    private static int clamp(int size) {
        return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    }
}
