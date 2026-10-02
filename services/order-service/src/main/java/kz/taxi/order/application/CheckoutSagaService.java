package kz.taxi.order.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyOutcome;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.CustomerOrder;
import kz.taxi.order.domain.MerchantAllocation;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.OrderFailure;
import kz.taxi.order.domain.OrderItem;
import kz.taxi.order.domain.OrderNumbers;
import kz.taxi.order.domain.OrderPayment;
import kz.taxi.order.domain.OrderStatus;
import kz.taxi.order.domain.OrderStatusHistory;
import kz.taxi.order.domain.OrderTotals;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.SagaState;
import kz.taxi.order.infrastructure.client.CatalogClient;
import kz.taxi.order.infrastructure.client.CatalogDtos;
import kz.taxi.order.infrastructure.client.PaymentClient;
import kz.taxi.order.infrastructure.config.OrderProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;

/**
 * The checkout saga: cart to paid order, with a compensation for every step that
 * can fail.
 *
 * <pre>
 *   1. cart (active, non-empty)  ->  order PENDING_PAYMENT + order.created
 *   2. catalog: reserve stock    ->  saga STOCK_RESERVED
 *   3. payment: one charge per merchant of the order
 *                                ->  every merchant COMPLETED: order PAID
 *                                    + order.paid + stock committed + cart consumed
 *                                    one merchant refused  : refund the merchants that
 *                                    were already paid + order CANCELLED
 *                                    + order.cancelled + stock released
 *                                    unknown outcome       : order stays PENDING_PAYMENT
 *                                    with the per-merchant progress written down
 * </pre>
 *
 * <p>Rules this class exists to enforce:
 *
 * <ul>
 *   <li><b>One payment per merchant.</b> A basket can hold goods from several
 *       sellers, and the payment contract and the settlement ledger are both per
 *       merchant, so the order is charged once per seller (see
 *       {@link MerchantAllocation} for how the money and the delivery fee are
 *       divided).</li>
 *   <li><b>Persist before you call.</b> Each merchant's payment line is written
 *       down before the call that may charge them, so a crash leaves an order that
 *       can be resumed instead of one nobody can explain.</li>
 *   <li><b>No remote call inside a transaction.</b> Every database change goes
 *       through {@link OrderLifecycleService} in its own short transaction; the HTTP
 *       calls happen in between, holding no locks.</li>
 *   <li><b>A partial success never survives.</b> If one merchant refuses, the
 *       merchants already paid are refunded (idempotently, keyed by order and
 *       merchant) and the stock hold is released. A customer must not end up paying
 *       for half an order and understanding none of it.</li>
 *   <li><b>An unknown outcome never becomes a decision.</b> Only a definite answer
 *       moves an order. A timeout, a 5xx, an unrecognised status or a payment for
 *       the wrong amount leaves the order in PENDING_PAYMENT, with the per-merchant
 *       progress in {@code order_payment}, for the reconciliation path — a decision
 *       made on a guess is how money gets lost.</li>
 *   <li><b>Idempotent by construction.</b> Every remote step is keyed by the order
 *       id (the reservation) or by a key derived from the order id and the merchant
 *       id (a payment, a refund), so a retried checkout, a redelivered Kafka event
 *       and a recovery-job pass all re-run the same steps without moving anything
 *       twice.</li>
 * </ul>
 *
 * <p>Business refusals (no stock, a declined card) end as an
 * {@link OrderErrorCode}: the order is durably CANCELLED first, then the caller is
 * told why, and the order id travels in the error details so the client can still
 * show the order. {@code PAYMENT_PENDING} is the opposite case: the outcome is not
 * known, so nothing is decided.
 *
 * <p>Orders created before split payments carry a single payment for the whole
 * order total on the order row and no {@code order_payment} lines; every path here
 * keeps resolving those exactly as it did before, because a deployment does not
 * finish every order in flight.
 */
@Service
@Slf4j
public class CheckoutSagaService {

    private final IdempotencyGuard idempotencyGuard;
    private final OrderLifecycleService lifecycle;
    private final OrderQueryService orderQuery;
    private final CartApplicationService cartService;
    private final CatalogClient catalogClient;
    private final PaymentClient paymentClient;
    private final OrderProperties properties;
    private final ObjectMapper objectMapper;

    public CheckoutSagaService(IdempotencyGuard idempotencyGuard,
                               OrderLifecycleService lifecycle,
                               OrderQueryService orderQuery,
                               CartApplicationService cartService,
                               CatalogClient catalogClient,
                               PaymentClient paymentClient,
                               OrderProperties properties,
                               ObjectMapper objectMapper) {
        this.idempotencyGuard = idempotencyGuard;
        this.lifecycle = lifecycle;
        this.orderQuery = orderQuery;
        this.cartService = cartService;
        this.catalogClient = catalogClient;
        this.paymentClient = paymentClient;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    /**
     * The result of a checkout.
     *
     * @param order                  the order as it stands after this call
     * @param awaitingPaymentOutcome true when the payment outcome is unknown and the
     *                               client should poll {@code GET /orders/{id}};
     *                               answered with 202 instead of 201
     */
    public record CheckoutResult(OrderDtos.OrderResponse order, boolean awaitingPaymentOutcome) {
    }

    // ------------------------------------------------------------------ checkout

    /**
     * Runs the checkout use case behind the caller's {@code Idempotency-Key}.
     *
     * <p>A processed key replays the stored response. A key whose request never
     * finished (the client saw a timeout, the guard released the key when the action
     * threw) re-enters this method, and the {@code idempotency_key} unique index on
     * the order table means the second attempt finds the first order and resumes it
     * instead of creating another one.
     */
    public CheckoutResult checkout(OrderDtos.CheckoutRequest request, String idempotencyKey, String userId) {
        IdempotencyOutcome<CheckoutResult> outcome = idempotencyGuard.execute(idempotencyKey, request,
                CheckoutResult.class, () -> runCheckout(request, idempotencyKey, userId));
        return outcome.body();
    }

    private CheckoutResult runCheckout(OrderDtos.CheckoutRequest request, String idempotencyKey, String userId) {
        Optional<CustomerOrder> previous = lifecycle.findByCheckoutKey(idempotencyKey);
        if (previous.isPresent()) {
            return resumeOrReplay(previous.get(), request.sourceAccountId());
        }

        CartApplicationService.ActiveCart cart = cartService.requireCheckoutCart(userId);
        OrderTotals totals = OrderTotals.ofCartItems(cart.items(), properties.deliveryFeeMinor());
        CustomerOrder order = createOrder(cart, request, idempotencyKey, totals);
        return driveSaga(order, cart.cart().getId(), request.sourceAccountId());
    }

    /**
     * Allocates the order row, retrying the readable order number.
     *
     * <p>The retry lives here, not in the lifecycle service, because a failed
     * transaction on PostgreSQL cannot be continued: the next attempt has to be a
     * new transaction. Two checkouts in the same millisecond compute the same
     * candidate number, and the unique index decides between them.
     */
    private CustomerOrder createOrder(CartApplicationService.ActiveCart cart,
                                      OrderDtos.CheckoutRequest request,
                                      String idempotencyKey,
                                      OrderTotals totals) {
        String requestHash = hashOf(request);
        for (int attempt = 0; attempt < OrderLifecycleService.orderNumberAttempts(); attempt++) {
            try {
                return lifecycle.createPendingOrder(cart.cart(), cart.items(), request, idempotencyKey,
                        requestHash, totals, attempt);
            } catch (DataIntegrityViolationException conflict) {
                Optional<CustomerOrder> existing = lifecycle.findByCheckoutKey(idempotencyKey);
                if (existing.isPresent()) {
                    log.info("checkout key already produced order {}; continuing with it",
                            existing.get().getOrderNumber());
                    return existing.get();
                }
                log.warn("order number collision while creating a checkout (attempt {}): {}",
                        attempt + 1, conflict.getMostSpecificCause().getMessage());
            }
        }
        throw DomainException.of(CommonErrorCode.SERVICE_UNAVAILABLE,
                "could not allocate an order number, please retry");
    }

    /** A retried checkout for an order that already exists. */
    private CheckoutResult resumeOrReplay(CustomerOrder order, String sourceAccountId) {
        if (order.isPendingPayment()) {
            // Every step of this saga is idempotent by the order id, so re-running
            // the remainder *is* the resume: the reservation returns the stored hold
            // and the payment key returns the payment that was already created.
            log.info("resuming the interrupted checkout of order {} from {}",
                    order.getOrderNumber(), order.getSagaState());
            return driveSaga(order, matchingCartId(order), sourceAccountId);
        }
        OrderFailure stored = OrderFailure.decode(order.getFailureReason()).orElse(null);
        if (stored != null && (order.isCancelled() || order.getStatus() == OrderStatus.FAILED)) {
            // The first attempt failed with a client-visible code; a retry of the
            // same request must see the same answer, not a fresh order.
            throw checkoutFailure(order, stored);
        }
        return new CheckoutResult(orderQuery.loadOrderResponse(order.getId()), false);
    }

    /**
     * The cart an order was checked out from, when it can be identified.
     *
     * <p>The order table has no {@code cart_id}, so the only safe way to find the
     * cart again is an exact match of its lines; anything less would consume a cart
     * the customer has since refilled.
     */
    private String matchingCartId(CustomerOrder order) {
        Map<String, Integer> lines = new LinkedHashMap<>();
        for (OrderItem item : lifecycle.itemsOf(order.getId())) {
            lines.merge(item.getProductId(), item.getQuantity(), Integer::sum);
        }
        return cartService.findMatchingActiveCartId(order.getUserId(), lines).orElse(null);
    }

    /**
     * Steps 2 and 3: reserve, charge, settle.
     *
     * @param cartId          the cart to consume when the saga succeeds, null when it
     *                        cannot be identified (an order resumed after a restart)
     * @param sourceAccountId the account the customer chose; on a retry it comes from
     *                        the retried request, which the idempotency guard has
     *                        already proven identical to the first one
     */
    private CheckoutResult driveSaga(CustomerOrder order, String cartId, String sourceAccountId) {
        List<OrderItem> items = lifecycle.itemsOf(order.getId());

        CatalogDtos.Reservation reservation;
        try {
            reservation = catalogClient.reserve(order.getId(), reservationLinesOf(items));
        } catch (DomainException refusal) {
            if (isBusinessRefusal(refusal)) {
                OrderFailure failure = OrderFailure.of(OrderErrorCode.PRODUCT_UNAVAILABLE, refusal.getMessage());
                cancelWithRelease(order, failure, OrderStatusHistory.ACTOR_CUSTOMER);
                throw checkoutFailure(order, failure);
            }
            // The catalog did not answer: the goods may or may not be held, and any
            // hold expires on its own. The order waits for the recovery job.
            lifecycle.recordNote(order.getId(), "stock reservation outcome unknown: " + refusal.getMessage());
            throw refusal;
        }

        OrderFailure mismatch = validateReservation(order, reservation);
        if (mismatch != null) {
            cancelWithRelease(order, mismatch, OrderStatusHistory.ACTOR_CUSTOMER);
            throw checkoutFailure(order, mismatch);
        }
        lifecycle.markStockReserved(order.getId());

        List<MerchantAllocation> allocations =
                MerchantAllocation.split(items, order.getDeliveryFeeMinor());
        List<OrderPayment> payments = lifecycle.startMerchantPayments(order.getId(), allocations);

        lifecycle.markPaymentRequested(order.getId());
        PaymentOutcome firstMerchant = null;
        for (OrderPayment line : payments) {
            PaymentOutcome payment;
            try {
                payment = paymentClient.createMerchantPayment(
                        PaymentClient.merchantPayment(
                                sourceAccountId,
                                line.getMerchantId(),
                                line.getAmountMinor(),
                                order.currencyCode(),
                                "Order " + order.getOrderNumber(),
                                order.getId()),
                        OrderNumbers.paymentIdempotencyKey(order.getId(), line.getMerchantId()));
            } catch (DomainException unknownOutcome) {
                lifecycle.markPaymentUnknown(order.getId(), unknownOutcome.getMessage());
                throw unknownOutcome;
            }

            if (payment.status().isCompleted()) {
                if (!payment.matches(line.getAmountMinor(), order.currencyCode())) {
                    // Money moved, but not for the amount this order says. Recording it
                    // would set the order's arithmetic on a number nobody agreed to, so
                    // the order waits for a human instead.
                    String amountMismatch = "the payment to merchant %s is for %d %s but the order holds %d %s"
                            .formatted(line.getMerchantId(), payment.amountMinor(), payment.currency(),
                                    line.getAmountMinor(), order.currencyCode());
                    log.error("order {}: {}", order.getOrderNumber(), amountMismatch);
                    lifecycle.markPaymentUnknown(order.getId(), amountMismatch);
                    return new CheckoutResult(orderQuery.loadOrderResponse(order.getId()), true);
                }
                lifecycle.markPaymentCompleted(order.getId(), line.getMerchantId(), payment);
                if (firstMerchant == null) {
                    // The order's own payment id is the first merchant's, in ascending
                    // merchant order — taken from the answer we just received, because
                    // the lines loaded from the database are detached copies.
                    firstMerchant = payment;
                }
                continue;
            }
            if (payment.status().isFailed()) {
                OrderFailure failure = OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED,
                        "the payment was declined for merchant %s: %s".formatted(line.getMerchantId(),
                                describe(payment)));
                lifecycle.markPaymentDeclined(order.getId(), line.getMerchantId(), payment);
                compensate(order, failure, OrderStatusHistory.ACTOR_PAYMENT_SERVICE);
                throw checkoutFailure(order, failure);
            }

            // A 201 whose status we do not recognise: money may or may not have moved.
            lifecycle.markPaymentUnknown(order.getId(), "the payment service answered status %s for merchant %s"
                    .formatted(payment.status(), line.getMerchantId()));
            return new CheckoutResult(orderQuery.loadOrderResponse(order.getId()), true);
        }

        // Every merchant answered, and every answer was "paid". The order's own
        // payment id is the first merchant's, in ascending merchant order.
        return finalizePaid(order.getId(), firstMerchant, OrderStatusHistory.ACTOR_PAYMENT_SERVICE, cartId);
    }

    // ------------------------------------------------------------------ settlement

    /**
     * Marks a paid order and commits the stock.
     *
     * <p>The order is marked PAID first, in its own transaction: money has moved, so
     * an order that still says PENDING_PAYMENT after a successful charge is the worst
     * of the possible states. The stock commit follows, and if it fails the saga
     * state ({@code STOCK_COMMIT_PENDING}) keeps the debt visible to the recovery job.
     */
    private CheckoutResult finalizePaid(String orderId, PaymentOutcome payment, String actor, String cartId) {
        if (payment == null) {
            // An order is paid because a merchant was; reaching this without a payment
            // would mean marking an order PAID with nothing to show for it.
            throw new IllegalStateException("a paid order must have at least one merchant payment");
        }
        lifecycle.markPaid(orderId, payment, actor);
        boolean committed = commitStock(orderId);
        if (committed && cartId != null) {
            cartService.markCheckedOut(cartId);
        }
        return new CheckoutResult(orderQuery.loadOrderResponse(orderId), false);
    }

    private boolean commitStock(String orderId) {
        try {
            catalogClient.commit(orderId);
            lifecycle.markStockCommitted(orderId);
            return true;
        } catch (DomainException failure) {
            log.warn("stock commit of order {} failed ({}); the order stays PAID and the recovery job retries",
                    orderId, failure.getMessage());
            return false;
        }
    }

    /**
     * The order as the money moved for it: its first merchant's payment line.
     *
     * <p>This is what {@code customer_order.payment_id} and the {@code paymentId}
     * field of the API hold. It stays a single value for compatibility, and it is
     * the <em>first</em> merchant (ascending merchant id) so that a resumed saga
     * and a fresh one answer with the same id; the per-merchant detail travels in
     * {@code payments}.
     */
    private PaymentOutcome firstMerchantPayment(String orderId) {
        return lifecycle.paymentsOf(orderId).stream()
                .findFirst()
                .map(OrderPayment::asOutcome)
                .orElseThrow(() -> new IllegalStateException("a paid order must have at least one payment line"));
    }

    // ------------------------------------------------------------------ compensation

    /**
     * Undoes what a refusal makes wrong: gives back every merchant that was already
     * paid, then releases the stock hold and cancels the order.
     *
     * <p>This is the rule that a partially paid order never survives. If a refund
     * fails, nothing is cancelled: the order keeps the money it holds — visible in
     * {@code order_payment} — and stays PENDING_PAYMENT with the saga state marked
     * as an unknown payment outcome, which is exactly the state the recovery job
     * exists to finish. Releasing the stock and cancelling on top of a failed refund
     * would take the goods off the shelf while the customer's money is still gone.
     */
    private void compensate(CustomerOrder order, OrderFailure failure, String actor) {
        String reason = "order %s could not be completed: %s".formatted(order.getOrderNumber(), failure.message());
        if (!refundPaidMerchants(order, reason)) {
            String debt = "the refund of a payment of order %s failed, so the order was not cancelled"
                    .formatted(order.getOrderNumber());
            lifecycle.markPaymentUnknown(order.getId(), debt);
            throw DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR,
                            "the payments of order {} could not all be refunded, so the order was not cancelled",
                            order.getOrderNumber())
                    .withDetail("orderId", order.getId())
                    .withDetail("status", order.getStatus().name());
        }
        cancelWithRelease(order, failure, actor);
    }

    /**
     * Gives back every completed payment of the order, merchant by merchant.
     *
     * <p>The refund key is derived from the order id and the merchant id, so a
     * compensation that is retried — a recovery pass, a redelivered event, a client
     * that retried the checkout — refunds each merchant once. Each line is marked
     * REFUNDED only after the payment service confirmed it, so a crash in between
     * leaves a retry of an idempotent refund rather than a line that claims money
     * came back when it did not.
     *
     * @return true when every completed payment is back (or there was none),
     *         false when one refund failed — the caller must then not cancel
     */
    private boolean refundPaidMerchants(CustomerOrder order, String reason) {
        for (OrderPayment line : lifecycle.paymentsOf(order.getId())) {
            if (!line.getStatus().isCompleted()) {
                // FAILED and REFUNDED lines owe nothing; a PENDING line is the
                // indeterminate case, which this method is only ever called on after
                // the caller stopped on a definite answer.
                continue;
            }
            if (line.getPaymentId() == null) {
                log.error("payment line of order {} for merchant {} is COMPLETED without a payment id; "
                        + "it cannot be refunded, so the order is left recoverable",
                        order.getOrderNumber(), line.getMerchantId());
                return false;
            }
            try {
                paymentClient.refund(line.getPaymentId(), reason,
                        OrderNumbers.refundIdempotencyKey(order.getId(), line.getMerchantId()));
                lifecycle.markPaymentRefunded(order.getId(), line.getMerchantId());
                log.info("refunded payment {} of order {} to merchant {}",
                        line.getPaymentId(), order.getOrderNumber(), line.getMerchantId());
            } catch (DomainException failure) {
                log.error("refund of payment {} (merchant {}) for order {} failed: {}",
                        line.getPaymentId(), line.getMerchantId(), order.getOrderNumber(), failure.getMessage());
                return false;
            }
        }
        return true;
    }

    /** Cancels an order and puts its stock back; a failed release stays visible in the saga state. */
    private void cancelWithRelease(CustomerOrder order, OrderFailure failure, String actor) {
        cancelWithRelease(order, failure.message(), actor, failure.encode());
    }

    private void cancelWithRelease(CustomerOrder order, String reason, String actor) {
        cancelWithRelease(order, reason, actor, reason);
    }

    private void cancelWithRelease(CustomerOrder order, String reason, String actor, String storedReason) {
        boolean released = releaseStock(order.getId(), reason);
        lifecycle.markCancelled(order.getId(), storedReason, actor, released);
    }

    private boolean releaseStock(String orderId, String reason) {
        try {
            catalogClient.release(orderId, reason);
            return true;
        } catch (DomainException failure) {
            log.warn("stock release of order {} failed ({}); the saga state now carries the debt",
                    orderId, failure.getMessage());
            return false;
        }
    }

    // ------------------------------------------------------------------ cancel

    /**
     * Cancels an order the customer no longer wants.
     *
     * <p>Decision table:
     * <ul>
     *   <li>{@code CANCELLED} — 200 with the current state; cancelling twice is not
     *       an error, it is the same intention.</li>
     *   <li>{@code PAID} / {@code CONFIRMED} / {@code FAILED} — 409
     *       {@code ORDER_NOT_CANCELLABLE}: money has moved, and a refund is a
     *       separate operation with its own audit trail.</li>
     *   <li>{@code PENDING_PAYMENT} with the payment never requested — release the
     *       stock, cancel.</li>
     *   <li>{@code PENDING_PAYMENT} whose payment <em>completed</em> — refund first,
     *       then release and cancel: we never cancel an order the customer paid for.
     *       On a split order every merchant that was paid is refunded before the
     *       stock goes back, so cancelling cannot leave a seller holding money for
     *       goods that are back on sale.</li>
     *   <li>{@code PENDING_PAYMENT} with an unknown payment outcome — 409
     *       {@code PAYMENT_PENDING} and no state change: the answer decides whether a
     *       refund is owed. On a split order that means any merchant whose payment
     *       was never answered, which is the same rule applied line by line.</li>
     * </ul>
     *
     * <p>The platform's {@code Idempotency-Key} is honoured when the client sends
     * one. It is not required here: the cancellation is idempotent by the state
     * machine, and the refund is idempotent by the key derived from the order id
     * (and, on a split order, from the merchant id).
     */
    public OrderDtos.OrderResponse cancel(String orderId,
                                          String reason,
                                          AuthenticatedUser requester,
                                          Optional<String> idempotencyKey) {
        Supplier<OrderDtos.OrderResponse> action = () -> doCancel(orderId, reason, requester);
        return idempotencyKey
                .map(key -> idempotencyGuard.execute(key, new CancelCommand(orderId, safeReason(reason)),
                        OrderDtos.OrderResponse.class, action).body())
                .orElseGet(action::get);
    }

    /** Request body the idempotency guard hashes for a cancellation. */
    private record CancelCommand(String orderId, String reason) {
    }

    private OrderDtos.OrderResponse doCancel(String orderId, String reason, AuthenticatedUser requester) {
        CustomerOrder order = lifecycle.requireOrder(orderId);
        requireAccess(order, requester);

        switch (order.getStatus()) {
            case CANCELLED -> {
                log.info("order {} is already cancelled; returning its state", order.getOrderNumber());
                return orderQuery.loadOrderResponse(orderId);
            }
            case PAID, CONFIRMED, FAILED -> throw DomainException.of(OrderErrorCode.ORDER_NOT_CANCELLABLE,
                            "order {} is {} and cannot be cancelled", order.getOrderNumber(), order.getStatus())
                    .withDetail("orderId", orderId)
                    .withDetail("status", order.getStatus().name());
            default -> {
                // DRAFT or PENDING_PAYMENT: cancellable, but only once we know
                // whether money moved.
            }
        }

        PaymentOutcome captured = null;
        List<OrderPayment> lines = lifecycle.paymentsOf(orderId);
        if (!lines.isEmpty()) {
            return cancelSplitOrder(order, lines, reason);
        }
        if (!order.isPaymentUntouched()) {
            Optional<PaymentOutcome> payment = resolvePaymentOrFail(order);
            if (payment.isPresent()) {
                if (payment.get().status().isCompleted()) {
                    captured = payment.get();
                } else if (payment.get().status().isUnknown()) {
                    throw paymentPending(order, "the payment service reported an unrecognised status");
                }
            }
        }

        if (captured != null) {
            refund(order, captured);
        }

        String storedReason = cancellationReason(reason, captured != null);
        cancelWithRelease(order, storedReason, OrderStatusHistory.ACTOR_CUSTOMER);
        return orderQuery.loadOrderResponse(orderId);
    }

    /**
     * Cancels an order that was charged per merchant.
     *
     * <p>The rule is the same as on the checkout path, from the other direction:
     * nothing is cancelled while any merchant's outcome is unknown (that answer
     * decides whether money is owed), every completed payment is refunded before
     * the stock goes back, and a refund that fails stops the cancellation.
     */
    private OrderDtos.OrderResponse cancelSplitOrder(CustomerOrder order, List<OrderPayment> lines, String reason) {
        for (OrderPayment line : lines) {
            if (line.getStatus().isPending()) {
                throw paymentPending(order, "the outcome of the payment to merchant %s is not known yet"
                        .formatted(line.getMerchantId()));
            }
        }
        boolean refunded = refundPaidMerchantsOrFail(order, lines);
        String storedReason = cancellationReason(reason, refunded);
        cancelWithRelease(order, storedReason, OrderStatusHistory.ACTOR_CUSTOMER);
        return orderQuery.loadOrderResponse(order.getId());
    }

    /**
     * Refunds the completed lines of a cancelled order, and refuses the
     * cancellation when one of them cannot be refunded.
     *
     * @return true when at least one merchant was actually paid and has been refunded
     */
    private boolean refundPaidMerchantsOrFail(CustomerOrder order, List<OrderPayment> lines) {
        boolean anyCompleted = lines.stream().anyMatch(line -> line.getStatus().isCompleted());
        if (!anyCompleted) {
            return false;
        }
        if (!refundPaidMerchants(order, "order %s cancelled by the customer".formatted(order.getOrderNumber()))) {
            throw DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR,
                            "the payments of order {} could not all be refunded, so the order was not cancelled",
                            order.getOrderNumber())
                    .withDetail("orderId", order.getId())
                    .withDetail("status", order.getStatus().name());
        }
        return true;
    }

    /**
     * Refunds the single payment of an order that carries one for its whole total:
     * every order created before split payments.
     *
     * <p>A failed refund aborts the cancellation: releasing the stock of an order
     * whose money we kept would leave the customer paying for goods that went back on
     * sale. Split orders go through {@link #refundPaidMerchants} instead, which
     * applies the same rule merchant by merchant.
     */
    private void refund(CustomerOrder order, PaymentOutcome payment) {
        String reason = "order " + order.getOrderNumber() + " cancelled by the customer";
        try {
            paymentClient.refund(payment.paymentId(), reason, OrderNumbers.refundIdempotencyKey(order.getId()));
            log.info("refunded payment {} of order {}", payment.paymentId(), order.getOrderNumber());
        } catch (DomainException failure) {
            log.error("refund of payment {} for order {} failed; the order is NOT cancelled: {}",
                    payment.paymentId(), order.getOrderNumber(), failure.getMessage());
            throw DomainException.of(OrderErrorCode.PAYMENT_SERVICE_ERROR,
                            "the payment of order {} could not be refunded, so the order was not cancelled",
                            order.getOrderNumber())
                    .withDetail("orderId", order.getId())
                    .withDetail("paymentId", payment.paymentId());
        }
    }

    // ------------------------------------------------------------------ reconciliation

    /**
     * Applies the outcome of {@code payment.completed} / {@code payment.failed}.
     *
     * <p>This is the asynchronous half of the saga: the payment service may finish a
     * payment after the synchronous call timed out, and this is how the order catches
     * up.
     *
     * <p>It is a no-op whenever the order is no longer PENDING_PAYMENT. That is the
     * common case, not an edge case: the synchronous path usually wins the race, and
     * Kafka delivers at least once, so the same event arrives twice. Nothing here
     * moves a PAID order, and nothing resurrects a CANCELLED one.
     */
    public void reconcilePayment(String orderId, PaymentOutcome reported, String actor) {
        reconcilePayment(orderId, null, reported, actor);
    }

    /**
     * The same, with the merchant the event names.
     *
     * <p>The merchant id is what lets an event settle the right line of an order that
     * was charged per merchant: the synchronous call records the payment id, but a
     * checkout whose answer was lost has no id to match on, and the merchant in the
     * event is then the only fact that says which line the money belongs to. An
     * event that matches nothing is never applied to "the order" — with several
     * merchants there is no such thing, and that guess is how one seller gets paid
     * twice and another never.
     */
    public void reconcilePayment(String orderId, String merchantId, PaymentOutcome reported, String actor) {
        CustomerOrder order = resolveReconcilableOrder(orderId, reported);
        if (order == null) {
            return;
        }
        List<OrderPayment> lines = lifecycle.paymentsOf(order.getId());
        if (lines.isEmpty()) {
            // An order created before split payments: one payment for the whole total.
            reconcileSinglePayment(order, reported, actor);
            return;
        }
        reconcileMerchantPayments(order, lines, merchantId, reported, actor);
    }

    /** The order an event is about, when it is an order this service is still waiting on. */
    private CustomerOrder resolveReconcilableOrder(String orderId, PaymentOutcome reported) {
        String resolvedOrderId = orderId != null
                ? orderId
                : lifecycle.findOrderByPaymentId(reported.paymentId()).map(CustomerOrder::getId).orElse(null);
        if (resolvedOrderId == null) {
            log.warn("payment event for payment {} does not name an order this service knows; ignoring it",
                    reported.paymentId());
            return null;
        }
        Optional<CustomerOrder> found = lifecycle.findOrder(resolvedOrderId);
        if (found.isEmpty()) {
            log.warn("payment event names order {} which this service does not know; ignoring it", resolvedOrderId);
            return null;
        }
        CustomerOrder order = found.get();
        if (!order.isPendingPayment()) {
            log.info("payment event for order {} ignored: the order is already {}",
                    order.getOrderNumber(), order.getStatus());
            return null;
        }
        return order;
    }

    /**
     * Settles one merchant's line, and the order with it once every line is paid.
     *
     * <p>An event never completes the order on its own: it completes the merchant it
     * names, and the order becomes PAID only when the last line of a split order
     * does. The stock commit and {@code order.paid} therefore still happen exactly
     * once, on the transition that finishes the order.
     */
    private void reconcileMerchantPayments(CustomerOrder order, List<OrderPayment> lines, String merchantId,
                                           PaymentOutcome reported, String actor) {
        OrderPayment line = matchLine(lines, reported, merchantId);
        if (line == null) {
            log.warn("payment event for payment {} names merchant {} and matches no line of order {} ({} lines); "
                            + "leaving it to the recovery job",
                    reported.paymentId(), merchantId, order.getOrderNumber(), lines.size());
            return;
        }

        if (reported.status().isCompleted()) {
            PaymentOutcome payment = confirmedPayment(order, line, reported);
            if (payment == null) {
                return;
            }
            if (!payment.matches(line.getAmountMinor(), order.currencyCode())) {
                log.error("payment {} of order {} to merchant {} is for {} {} but the order holds {} {}; "
                                + "NOT marking it paid",
                        payment.paymentId(), order.getOrderNumber(), line.getMerchantId(),
                        payment.amountMinor(), payment.currency(),
                        line.getAmountMinor(), order.currencyCode());
                return;
            }
            lifecycle.markPaymentCompleted(order.getId(), line.getMerchantId(), payment);
            List<OrderPayment> after = lifecycle.paymentsOf(order.getId());
            long outstanding = after.stream().filter(row -> !row.getStatus().isCompleted()).count();
            if (outstanding == 0) {
                finalizePaid(order.getId(), firstMerchantPayment(order.getId()), actor, null);
            } else {
                log.info("order {} is partly paid: {} of {} merchant payment(s) still owed",
                        order.getOrderNumber(), outstanding, after.size());
            }
            return;
        }
        if (reported.status().isFailed()) {
            OrderFailure failure = OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED,
                    "the payment was declined for merchant %s: %s".formatted(line.getMerchantId(),
                            describe(reported)));
            lifecycle.markPaymentDeclined(order.getId(), line.getMerchantId(), reported);
            // The same rule as the synchronous path: a partially paid order never
            // survives. A refund that fails throws, which is what puts the event back
            // for a retry instead of cancelling an order whose money is still held.
            compensate(order, failure, actor);
            return;
        }
        log.warn("payment event for order {} carries no usable outcome; leaving the order pending",
                order.getOrderNumber());
    }

    /**
     * The line a payment event is about, or null when that cannot be established.
     *
     * <p>Three attempts, in decreasing order of certainty: the payment id the line
     * already recorded, the merchant the event names (only for a line that has no
     * payment id yet — that is the case this exists for), and, for an order with a
     * single line, that line, which is unambiguous by definition.
     */
    private OrderPayment matchLine(List<OrderPayment> lines, PaymentOutcome reported, String merchantId) {
        if (reported.paymentId() != null) {
            Optional<OrderPayment> recorded = lines.stream()
                    .filter(line -> reported.paymentId().equals(line.getPaymentId()))
                    .findFirst();
            if (recorded.isPresent()) {
                return recorded.get();
            }
        }
        if (merchantId != null) {
            Optional<OrderPayment> byMerchant = lines.stream()
                    .filter(line -> merchantId.equals(line.getMerchantId()) && line.getPaymentId() == null)
                    .findFirst();
            if (byMerchant.isPresent()) {
                return byMerchant.get();
            }
        }
        return lines.size() == 1 ? lines.get(0) : null;
    }

    /**
     * The payment the order service is willing to trust for one line.
     *
     * <p>An event that carries no amount cannot be checked against the line, so the
     * payment service is asked for the payment itself; an event that carries one is
     * used as it stands. Nothing is decided on an amount nobody can confirm.
     */
    private PaymentOutcome confirmedPayment(CustomerOrder order, OrderPayment line, PaymentOutcome reported) {
        if (reported.amountMinor() > 0 && reported.currency() != null) {
            return reported;
        }
        PaymentOutcome payment = lookupLinePaymentOrNull(order, line);
        if (payment == null) {
            log.warn("cannot confirm the amount of the payment of order {} to merchant {}; "
                            + "leaving it to the recovery job",
                    order.getOrderNumber(), line.getMerchantId());
        }
        return payment;
    }

    /** One line's payment, read by its own id first and by the order id as a fallback. */
    private PaymentOutcome lookupLinePaymentOrNull(CustomerOrder order, OrderPayment line) {
        try {
            if (line.getPaymentId() != null) {
                Optional<PaymentOutcome> byId = paymentClient.findByPaymentId(line.getPaymentId());
                if (byId.isPresent()) {
                    return byId.get();
                }
            }
            return paymentClient.findByOrderId(order.getId()).orElse(null);
        } catch (DomainException failure) {
            log.warn("cannot read the payment of order {} to merchant {}: {}",
                    order.getOrderNumber(), line.getMerchantId(), failure.getMessage());
            return null;
        }
    }

    /**
     * The reconciliation of an order that carries one payment for its whole total:
     * every order created before split payments, and any still in flight.
     */
    private void reconcileSinglePayment(CustomerOrder order, PaymentOutcome reported, String actor) {
        PaymentOutcome payment = reported;
        if (payment.status().isCompleted() && (payment.amountMinor() <= 0 || payment.currency() == null)) {
            // The event did not carry an amount we can check. The payment service is
            // the authority on it, and marking an order PAID on an unverified amount
            // is exactly what this check exists to prevent.
            payment = lookupPaymentOrNull(order);
            if (payment == null) {
                log.warn("cannot confirm the amount of the payment of order {}; leaving it to the recovery job",
                        order.getOrderNumber());
                return;
            }
        }

        if (payment.status().isCompleted()) {
            if (!payment.matches(order.getTotalMinor(), order.currencyCode())) {
                log.error("payment {} of order {} is for {} {} but the order totals {} {}; NOT marking it paid",
                        payment.paymentId(), order.getOrderNumber(), payment.amountMinor(), payment.currency(),
                        order.getTotalMinor(), order.currencyCode());
                return;
            }
            finalizePaid(order.getId(), payment, actor, null);
            return;
        }
        if (payment.status().isFailed()) {
            OrderFailure failure = OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED,
                    "the payment was declined: " + describe(payment));
            lifecycle.markPaymentDeclined(order.getId(), payment);
            cancelWithRelease(order, failure, actor);
            return;
        }
        log.warn("payment event for order {} carries no usable outcome; leaving the order pending",
                order.getOrderNumber());
    }

    /**
     * Resolves orders that have been PENDING_PAYMENT for longer than the saga
     * timeout. The rule, in the order it is applied:
     *
     * <ol>
     *   <li><b>The payment was never requested</b> ({@code NEW}, {@code STOCK_RESERVED})
     *       — no money can have moved, so release the stock and cancel. This is the
     *       order left behind by a checkout that died before the charge.</li>
     *   <li><b>The payment service knows nothing about the order</b> — nothing was
     *       charged, so release and cancel.</li>
     *   <li><b>The payment outcome is known</b> — completed: commit the stock and mark
     *       PAID (after checking the amount); failed: release and cancel. The same
     *       code as the event stream, so both routes agree on the same fact.</li>
     *   <li><b>Anything else</b> — the payment service is unreachable, refused the
     *       lookup, or answered with an unrecognised status: leave the order exactly
     *       as it is and try again on the next pass. An order whose money may be in
     *       flight is never cancelled by a timer.</li>
     * </ol>
     *
     * @return how many orders this pass resolved
     */
    public int recoverStuckCheckouts() {
        Instant olderThan = Instant.now().minus(properties.sagaTimeout());
        List<CustomerOrder> stuck = lifecycle.findStuckPending(olderThan, properties.recoveryBatchSize());
        int resolved = 0;
        for (CustomerOrder order : stuck) {
            try {
                if (resolveStuckOrder(order)) {
                    resolved++;
                }
            } catch (RuntimeException failure) {
                // One unreachable payment must not stop the batch.
                log.warn("could not resolve pending order {}: {}", order.getOrderNumber(), failure.toString());
            }
        }
        return resolved;
    }

    private boolean resolveStuckOrder(CustomerOrder order) {
        if (order.isPaymentUntouched()) {
            log.info("cancelling abandoned checkout {} ({}): the payment was never requested",
                    order.getOrderNumber(), order.getSagaState());
            cancelWithRelease(order, "the checkout was abandoned before the payment was requested",
                    OrderStatusHistory.ACTOR_RECOVERY_JOB);
            return true;
        }

        List<OrderPayment> lines = lifecycle.paymentsOf(order.getId());
        if (!lines.isEmpty()) {
            return resolveStuckSplitOrder(order, lines);
        }

        Optional<PaymentOutcome> payment = lookupPayment(order);
        if (payment.isEmpty()) {
            log.info("cancelling pending order {}: the payment service has no payment for it",
                    order.getOrderNumber());
            cancelWithRelease(order, "the payment service has no payment for this order; nothing was charged",
                    OrderStatusHistory.ACTOR_RECOVERY_JOB);
            return true;
        }

        PaymentOutcome found = payment.get();
        if (found.status().isCompleted()) {
            if (!found.matches(order.getTotalMinor(), order.currencyCode())) {
                log.error("payment {} of order {} is for {} {} but the order totals {} {}; leaving it for a human",
                        found.paymentId(), order.getOrderNumber(), found.amountMinor(), found.currency(),
                        order.getTotalMinor(), order.currencyCode());
                return false;
            }
            finalizePaid(order.getId(), found, OrderStatusHistory.ACTOR_RECOVERY_JOB, null);
            return true;
        }
        if (found.status().isFailed()) {
            OrderFailure failure = OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED,
                    "the payment was declined: " + describe(found));
            lifecycle.markPaymentDeclined(order.getId(), found);
            cancelWithRelease(order, failure, OrderStatusHistory.ACTOR_RECOVERY_JOB);
            return true;
        }
        log.warn("order {} stays PENDING_PAYMENT: the payment outcome is still unknown", order.getOrderNumber());
        return false;
    }

    /**
     * Resolves a stuck order that was charged per merchant, from the progress the
     * saga wrote down.
     *
     * <p>The rule is the checkout's rule, applied to facts that arrived late: an
     * order is PAID when every line is paid, and it is CANCELLED — with the paid
     * merchants refunded first — as soon as one line is refused or was never
     * charged, because a partially paid order must not survive. A single line whose
     * outcome cannot be established stops the pass: the recovery job never guesses
     * on a timer, and a merchant's money may be in flight.
     */
    private boolean resolveStuckSplitOrder(CustomerOrder order, List<OrderPayment> lines) {
        List<LineState> states = new ArrayList<>(lines.size());
        for (OrderPayment line : lines) {
            LineState state = resolveLine(order, line, lines);
            if (!state.isKnown()) {
                log.warn("order {} stays PENDING_PAYMENT: the outcome of the payment to merchant {} is still unknown",
                        order.getOrderNumber(), line.getMerchantId());
                return false;
            }
            // Written down before it is acted on, so the next pass and the API see
            // the progress (and the payment id of a line whose answer was lost).
            persistFinding(order, state);
            states.add(state);
        }

        if (states.stream().allMatch(LineState::isCompleted)) {
            finalizePaid(order.getId(), firstMerchantPayment(order.getId()),
                    OrderStatusHistory.ACTOR_RECOVERY_JOB, null);
            return true;
        }

        boolean anyPaid = states.stream().anyMatch(LineState::isCompleted);
        if (anyPaid && !refundPaidMerchants(order,
                "order %s could not be completed by every merchant".formatted(order.getOrderNumber()))) {
            log.warn("order {} stays PENDING_PAYMENT: a payment could not be refunded, it is retried next pass",
                    order.getOrderNumber());
            return false;
        }

        boolean everCharged = anyPaid || states.stream().anyMatch(LineState::isRefunded);
        LineState refused = states.stream().filter(LineState::isFailed).findFirst().orElse(null);
        if (refused == null && !everCharged) {
            log.info("cancelling pending order {}: the payment service has no payment for it",
                    order.getOrderNumber());
            cancelWithRelease(order, "the payment service has no payment for this order; nothing was charged",
                    OrderStatusHistory.ACTOR_RECOVERY_JOB);
            return true;
        }

        OrderFailure failure = refused == null
                ? OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED,
                        "not every merchant of the order could be charged")
                : OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED,
                        "the payment was declined for merchant %s: %s".formatted(refused.line().getMerchantId(),
                                describe(refused.payment())));
        if (refused != null) {
            lifecycle.markPaymentDeclined(order.getId(), refused.line().getMerchantId(), refused.payment());
        }
        cancelWithRelease(order, failure, OrderStatusHistory.ACTOR_RECOVERY_JOB);
        return true;
    }

    /** Writes down what a stuck order's line turned out to be, unless it is already recorded. */
    private void persistFinding(CustomerOrder order, LineState state) {
        if (state.line().getStatus().isSettled()) {
            return;
        }
        if (state.isCompleted()) {
            lifecycle.markPaymentCompleted(order.getId(), state.line().getMerchantId(), state.payment());
        } else if (state.isFailed()) {
            lifecycle.markPaymentFailed(order.getId(), state.line().getMerchantId(), state.payment());
        }
    }

    /**
     * What the payment service actually did for one merchant's line.
     *
     * <p>A settled line is a fact and is read as itself. A PENDING line is asked
     * about, by its own payment id when the saga recorded one.
     *
     * <p>A PENDING line with no payment id is the hard case: the answer to the
     * charge was lost. The payment service can only be asked for "the payment of
     * this order", which returns one of possibly several, so a payment is adopted
     * only when it can be attributed to exactly one line — same amount and currency,
     * and not already recorded on another line. Anything else stays unknown, and the
     * order waits: an unattributable payment is a human's problem, never a reason to
     * cancel an order that may be paid.
     */
    private LineState resolveLine(CustomerOrder order, OrderPayment line, List<OrderPayment> lines) {
        if (line.getStatus().isSettled()) {
            // A line the saga already settled is a fact, not a question: nothing to ask,
            // and nothing to decide (a REFUNDED line owes nothing).
            return LineState.settled(line);
        }
        if (line.getPaymentId() != null) {
            PaymentOutcome payment = readPaymentOrNull(line.getPaymentId(), order);
            return payment == null ? LineState.unknown(line) : new LineState(line, payment, true);
        }
        Optional<PaymentOutcome> byOrder;
        try {
            byOrder = paymentClient.findByOrderId(order.getId());
        } catch (DomainException failure) {
            log.warn("cannot read the payments of order {}: {}", order.getOrderNumber(), failure.getMessage());
            return LineState.unknown(line);
        }
        if (byOrder.isEmpty()) {
            // The payment service knows no payment for this order at all: nothing was
            // charged for this merchant either.
            return LineState.neverCharged(line);
        }
        PaymentOutcome candidate = byOrder.get();
        if (isClaimedByAnotherLine(candidate.paymentId(), line, lines)
                || !candidate.matches(line.getAmountMinor(), order.currencyCode())) {
            return LineState.unknown(line);
        }
        return new LineState(line, candidate, true);
    }

    private PaymentOutcome readPaymentOrNull(String paymentId, CustomerOrder order) {
        try {
            return paymentClient.findByPaymentId(paymentId).orElse(null);
        } catch (DomainException failure) {
            log.warn("cannot read payment {} of order {}: {}", paymentId, order.getOrderNumber(),
                    failure.getMessage());
            return null;
        }
    }

    private static boolean isClaimedByAnotherLine(String paymentId, OrderPayment line, List<OrderPayment> lines) {
        if (paymentId == null) {
            return false;
        }
        return lines.stream()
                .anyMatch(other -> !other.getId().equals(line.getId()) && paymentId.equals(other.getPaymentId()));
    }

    /**
     * One merchant's line, resolved.
     *
     * @param line      the persisted line this is about
     * @param payment   what the payment service says about it, null when there is none
     * @param answered  true when the outcome needs no further question — the line was
     *                  already settled, or the payment service was reached and its
     *                  answer (including "no payment at all") is a fact
     */
    private record LineState(OrderPayment line, PaymentOutcome payment, boolean answered) {

        static LineState unknown(OrderPayment line) {
            return new LineState(line, null, false);
        }

        static LineState settled(OrderPayment line) {
            return new LineState(line, line.asOutcome(), true);
        }

        static LineState neverCharged(OrderPayment line) {
            return new LineState(line, null, true);
        }

        /** True when the state is a fact rather than a question. */
        boolean isKnown() {
            return answered || (payment != null && !payment.status().isUnknown());
        }

        boolean isCompleted() {
            return payment != null && payment.status().isCompleted();
        }

        boolean isFailed() {
            return payment != null && payment.status().isFailed();
        }

        boolean isRefunded() {
            return line.getStatus().isRefunded();
        }
    }

    /** Retries stock releases a cancelled order still owes. */
    public int retryPendingCompensations() {
        Instant olderThan = Instant.now().minus(properties.sagaTimeout());
        List<CustomerOrder> pending = lifecycle.findInSagaStates(
                Set.of(SagaState.STOCK_RELEASE_PENDING), olderThan, properties.recoveryBatchSize());
        int released = 0;
        for (CustomerOrder order : pending) {
            try {
                if (releaseStock(order.getId(), order.getFailureReason())) {
                    lifecycle.markStockReleased(order.getId());
                    released++;
                }
            } catch (RuntimeException failure) {
                log.warn("could not release the stock of order {}: {}", order.getOrderNumber(), failure.toString());
            }
        }
        return released;
    }

    /** Retries stock commits of paid orders whose commit call failed. */
    public int retryPendingStockCommits() {
        Instant olderThan = Instant.now().minus(properties.sagaTimeout());
        List<CustomerOrder> pending = lifecycle.findInSagaStates(
                Set.of(SagaState.STOCK_COMMIT_PENDING), olderThan, properties.recoveryBatchSize());
        int committed = 0;
        for (CustomerOrder order : pending) {
            try {
                if (commitStock(order.getId())) {
                    committed++;
                }
            } catch (RuntimeException failure) {
                log.warn("could not commit the stock of order {}: {}", order.getOrderNumber(), failure.toString());
            }
        }
        return committed;
    }

    // ------------------------------------------------------------------ helpers

    /**
     * The order's own items price the reservation, never the cart's: a resumed
     * checkout must reserve exactly what the order says, even if the cart moved on.
     */
    private static List<CatalogDtos.ReserveStockItem> reservationLinesOf(List<OrderItem> items) {
        return items.stream()
                .map(item -> new CatalogDtos.ReserveStockItem(item.getProductId(), item.getQuantity()))
                .toList();
    }

    /**
     * Re-checks what the catalog quoted against what the order says.
     *
     * <p>The customer agreed to a total; the reservation is the catalog's answer
     * about the current price. If they disagree, the checkout is cancelled instead of
     * charging a number nobody agreed to.
     */
    private static OrderFailure validateReservation(CustomerOrder order, CatalogDtos.Reservation reservation) {
        if (reservation.currency() != null && !reservation.currency().equalsIgnoreCase(order.currencyCode())) {
            return OrderFailure.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                    "the catalog holds this order in %s while the order is in %s"
                            .formatted(reservation.currency(), order.currencyCode()));
        }
        if (reservation.subtotalMinor() != order.getSubtotalMinor()) {
            return OrderFailure.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                    "prices changed while checking out: the order holds %d %s but the catalog now quotes %d %s"
                            .formatted(order.getSubtotalMinor(), order.currencyCode(),
                                    reservation.subtotalMinor(), reservation.currency()));
        }
        return null;
    }

    private static DomainException checkoutFailure(CustomerOrder order, OrderFailure failure) {
        return DomainException.of(failure.code(),
                        "checkout {} ended as CANCELLED: {}", order.getOrderNumber(), failure.message())
                .withDetail("orderId", order.getId())
                .withDetail("orderNumber", order.getOrderNumber())
                .withDetail("status", OrderStatus.CANCELLED.name())
                .withDetail("failureReason", failure.encode());
    }

    private static DomainException paymentPending(CustomerOrder order, String cause) {
        return DomainException.of(OrderErrorCode.PAYMENT_PENDING,
                        "the payment outcome of order {} is not known yet ({}), so it was not cancelled; "
                                + "try again in a moment", order.getOrderNumber(), cause)
                .withDetail("orderId", order.getId())
                .withDetail("status", order.getStatus().name());
    }

    /**
     * Asks the payment service what happened: by order id first, then by the stored
     * payment id.
     *
     * <p>The second lookup is not redundant — the two endpoints may not be authorized
     * the same way, so a caller that cannot read the order's payment may still be able
     * to read the payment itself.
     */
    private Optional<PaymentOutcome> lookupPayment(CustomerOrder order) {
        RuntimeException firstFailure = null;
        try {
            Optional<PaymentOutcome> byOrder = paymentClient.findByOrderId(order.getId());
            if (byOrder.isPresent()) {
                return byOrder;
            }
        } catch (RuntimeException failure) {
            firstFailure = failure;
        }
        if (order.getPaymentId() != null) {
            try {
                return paymentClient.findByPaymentId(order.getPaymentId());
            } catch (RuntimeException failure) {
                if (firstFailure == null) {
                    firstFailure = failure;
                }
            }
        }
        if (firstFailure != null) {
            throw firstFailure;
        }
        return Optional.empty();
    }

    private PaymentOutcome lookupPaymentOrNull(CustomerOrder order) {
        try {
            return lookupPayment(order).orElse(null);
        } catch (DomainException failure) {
            log.warn("cannot read the payment of order {}: {}", order.getOrderNumber(), failure.getMessage());
            return null;
        }
    }

    /** A payment lookup that cannot be answered is not a cancellation. */
    private Optional<PaymentOutcome> resolvePaymentOrFail(CustomerOrder order) {
        try {
            return lookupPayment(order);
        } catch (DomainException failure) {
            throw paymentPending(order, failure.getMessage());
        }
    }

    private static boolean isBusinessRefusal(DomainException failure) {
        return failure.errorCode() == OrderErrorCode.PRODUCT_UNAVAILABLE;
    }

    private static void requireAccess(CustomerOrder order, AuthenticatedUser requester) {
        if (requester == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!requester.canAccess(order.getUserId())) {
            throw DomainException.forbidden("order {} belongs to another user", order.getOrderNumber());
        }
    }

    private static String describe(PaymentOutcome payment) {
        String reason = payment.failureReason() != null && !payment.failureReason().isBlank()
                ? payment.failureReason()
                : "the payment was declined";
        return payment.failureCode() == null ? reason : "%s (%s)".formatted(reason, payment.failureCode());
    }

    private static String cancellationReason(String reason, boolean refunded) {
        String base = reason == null || reason.isBlank() ? "cancelled by the customer" : "cancelled: " + reason;
        return refunded ? base + " (payment refunded)" : base;
    }

    private static String safeReason(String reason) {
        return reason == null ? "" : reason;
    }

    /** The request hash stored next to the idempotency key, for incident forensics. */
    private String hashOf(Object body) {
        try {
            String canonical = objectMapper.writeValueAsString(body);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new IllegalStateException("cannot hash the checkout request", failure);
        }
    }
}
