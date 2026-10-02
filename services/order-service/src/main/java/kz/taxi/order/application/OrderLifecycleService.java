package kz.taxi.order.application;

import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartItem;
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
import kz.taxi.order.infrastructure.CustomerOrderRepository;
import kz.taxi.order.infrastructure.OrderItemRepository;
import kz.taxi.order.infrastructure.OrderPaymentRepository;
import kz.taxi.order.infrastructure.OrderStatusHistoryRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * The transactional half of the checkout saga: every state change of an order,
 * each one in its own short transaction.
 *
 * <p>Two invariants live here and nowhere else:
 *
 * <ul>
 *   <li><b>An order row and its outbox row commit together.</b> Every method that
 *       changes the order appends the event in the same transaction, so a crash
 *       cannot produce a paid order nobody was told about, or an event about a
 *       change that never happened.</li>
 *   <li><b>No remote call inside a transaction.</b> The saga orchestrator calls a
 *       method here, then a client, then a method here again. Holding a database
 *       row lock across an HTTP call is how a slow downstream service becomes a
 *       connection-pool outage in this one.</li>
 * </ul>
 *
 * <p>Every state change also writes a history row, because "why is this order in
 * this state" is the first question support asks and log files do not answer it
 * after a retention window.
 */
@Service
@Slf4j
public class OrderLifecycleService {

    private static final String AGGREGATE_TYPE = "Order";
    /** How many order numbers a single checkout may try before giving up. */
    private static final int ORDER_NUMBER_ATTEMPTS = 5;

    private final CustomerOrderRepository orderRepository;
    private final OrderItemRepository orderItemRepository;
    private final OrderStatusHistoryRepository historyRepository;
    private final OrderPaymentRepository paymentRepository;
    private final OutboxWriter outboxWriter;

    public OrderLifecycleService(CustomerOrderRepository orderRepository,
                                 OrderItemRepository orderItemRepository,
                                 OrderStatusHistoryRepository historyRepository,
                                 OrderPaymentRepository paymentRepository,
                                 OutboxWriter outboxWriter) {
        this.orderRepository = orderRepository;
        this.orderItemRepository = orderItemRepository;
        this.historyRepository = historyRepository;
        this.paymentRepository = paymentRepository;
        this.outboxWriter = outboxWriter;
    }

    // ------------------------------------------------------------------ creation

    /**
     * Writes the order a checkout starts from, with its lines and its first event.
     *
     * @param attempt which candidate order number this is; the caller retries with
     *                the next one when the readable sequence collides, and the
     *                caller — not this method — owns the retry because a failed
     *                transaction cannot continue in the same transaction on
     *                PostgreSQL
     */
    @Transactional
    public CustomerOrder createPendingOrder(Cart cart,
                                            List<CartItem> items,
                                            OrderDtos.CheckoutRequest request,
                                            String idempotencyKey,
                                            String requestHash,
                                            OrderTotals totals,
                                            int attempt) {
        String orderNumber = OrderNumbers.format(LocalDate.now(ZoneOffset.UTC), nextDailySequence(attempt));
        CustomerOrder order = orderRepository.save(CustomerOrder.create(
                orderNumber,
                cart.getUserId(),
                totals.currency(),
                totals,
                idempotencyKey,
                requestHash,
                request.deliveryAddress(),
                request.contactPhone(),
                request.comment(),
                CorrelationContext.get()));

        List<OrderItem> orderItems = items.stream()
                .map(item -> OrderItem.fromCartItem(order.getId(), item))
                .toList();
        orderItemRepository.saveAll(orderItems);
        historyRepository.save(OrderStatusHistory.of(order.getId(), null, OrderStatus.PENDING_PAYMENT,
                "checkout started from cart " + cart.getId(), OrderStatusHistory.ACTOR_CUSTOMER));
        append(order, KafkaTopics.Events.ORDER_CREATED, orderItems.size());
        log.info("order {} created from cart {} for user {}: {} {} ({} lines)",
                order.getOrderNumber(), cart.getId(), order.getUserId(),
                order.getTotalMinor(), order.currencyCode(), orderItems.size());
        return order;
    }

    /** The number of orders already created today, the readable part of the next number. */
    private long nextDailySequence(int attempt) {
        Instant startOfDay = LocalDate.now(ZoneOffset.UTC).atStartOfDay(ZoneOffset.UTC).toInstant();
        return orderRepository.countByCreatedAtGreaterThanEqual(startOfDay) + 1L + attempt;
    }

    /** Attempts allowed before a checkout gives up on allocating an order number. */
    public static int orderNumberAttempts() {
        return ORDER_NUMBER_ATTEMPTS;
    }

    // ------------------------------------------------------------------ saga steps

    @Transactional
    public CustomerOrder markStockReserved(String orderId) {
        CustomerOrder order = lock(orderId);
        order.markStockReserved();
        return order;
    }

    @Transactional
    public CustomerOrder markPaymentRequested(String orderId) {
        CustomerOrder order = lock(orderId);
        order.markPaymentRequested();
        return order;
    }

    // ------------------------------------------------------------------ merchant payments

    /**
     * Writes down the payments this order is about to need, one row per merchant.
     *
     * <p>Called <em>before</em> the first payment call, and reusing the rows that
     * already exist: a resumed checkout, a retried request and a recovery pass all
     * find the same list, with the outcomes recorded so far, instead of inventing a
     * second set of charges. That is what makes "persist before you call" work for
     * a saga with several remote calls in it.
     *
     * <p>The order row is locked for the duration, so two concurrent resumes cannot
     * both decide to insert the same merchant's line; the unique index on
     * {@code (order_id, merchant_id)} is the second line of defence. No remote call
     * happens here.
     */
    @Transactional
    public List<OrderPayment> startMerchantPayments(String orderId, List<MerchantAllocation> allocations) {
        CustomerOrder order = lock(orderId);
        List<OrderPayment> payments = new ArrayList<>(allocations.size());
        for (MerchantAllocation allocation : allocations) {
            OrderPayment payment = paymentRepository
                    .findByOrderIdAndMerchantId(orderId, allocation.merchantId())
                    .orElseGet(() -> paymentRepository.save(OrderPayment.pending(orderId,
                            allocation.merchantId(), allocation.amountMinor(), order.getCurrency())));
            if (payment.getAmountMinor() != allocation.amountMinor()) {
                // The order's lines are frozen, so a different amount here means the
                // order was written by something other than this checkout. Charging it
                // would move an amount nobody agreed to.
                log.error("payment line of order {} for merchant {} holds {} but the order asks for {}",
                        order.getOrderNumber(), allocation.merchantId(),
                        payment.getAmountMinor(), allocation.amountMinor());
            }
            payments.add(payment);
        }
        log.info("order {} is charged as {} merchant payment(s) totalling {} {} (delivery fee carried by {})",
                order.getOrderNumber(), payments.size(),
                allocations.stream().mapToLong(MerchantAllocation::amountMinor).sum(), order.currencyCode(),
                allocations.stream().filter(MerchantAllocation::carriesDeliveryFee)
                        .map(MerchantAllocation::merchantId).findFirst().orElse("-"));
        return payments;
    }

    /**
     * Records that one merchant was paid.
     *
     * <p>Per merchant, and idempotent: the order is only marked PAID once every line
     * is COMPLETED (see {@code CheckoutSagaService}), so applying the same answer
     * twice must not move anything twice.
     */
    @Transactional
    public OrderPayment markPaymentCompleted(String orderId, String merchantId, PaymentOutcome payment) {
        OrderPayment line = requirePayment(orderId, merchantId);
        line.markCompleted(payment);
        log.info("order {} paid merchant {} ({} {}) with payment {}",
                orderId, merchantId, line.getAmountMinor(), line.currencyCode(), payment.paymentId());
        return line;
    }

    /** Records that one merchant refused; nothing moved for them. */
    @Transactional
    public OrderPayment markPaymentFailed(String orderId, String merchantId, PaymentOutcome payment) {
        OrderPayment line = requirePayment(orderId, merchantId);
        line.markFailed(payment);
        return line;
    }

    /**
     * Records that one merchant's money went back.
     *
     * <p>Written only after the payment service confirmed the refund, so a crash
     * between the two leaves a COMPLETED line and a retry of the same idempotent
     * refund — never a REFUNDED line with the money still held.
     */
    @Transactional
    public OrderPayment markPaymentRefunded(String orderId, String merchantId) {
        OrderPayment line = requirePayment(orderId, merchantId);
        line.markRefunded();
        log.info("payment of order {} to merchant {} was refunded", orderId, merchantId);
        return line;
    }

    /** One merchant's line of an order, or a loud failure: the row is written before the call. */
    @Transactional(readOnly = true)
    public OrderPayment requirePayment(String orderId, String merchantId) {
        return paymentRepository.findByOrderIdAndMerchantId(orderId, merchantId)
                .orElseThrow(() -> DomainException.conflict(
                        "order {} has no payment line for merchant {}", orderId, merchantId)
                        .withDetail("orderId", orderId)
                        .withDetail("merchantId", merchantId));
    }

    /** The order's payments, ascending merchant id: the order the saga charges them in. */
    @Transactional(readOnly = true)
    public List<OrderPayment> paymentsOf(String orderId) {
        return paymentRepository.findByOrderIdOrderByMerchantIdAsc(orderId);
    }

    @Transactional
    public CustomerOrder markPaymentUnknown(String orderId, String reason) {
        CustomerOrder order = lock(orderId);
        order.markPaymentUnknown(reason);
        log.warn("order {} is left in PENDING_PAYMENT: {}", order.getOrderNumber(), reason);
        return order;
    }

    /** Money captured: the order becomes PAID and announces it, in one commit. */
    @Transactional
    public CustomerOrder markPaid(String orderId, PaymentOutcome payment, String actor) {
        CustomerOrder order = lock(orderId);
        OrderStatus previous = order.getStatus();
        order.markPaid(payment);
        historyRepository.save(OrderStatusHistory.of(orderId, previous, OrderStatus.PAID,
                "payment %s completed".formatted(payment.paymentId()), actor));
        append(order, KafkaTopics.Events.ORDER_PAID, itemCount(orderId));
        log.info("order {} paid with payment {}", order.getOrderNumber(), payment.paymentId());
        return order;
    }

    /**
     * The payment service refused; nothing moved.
     *
     * <p>The two-argument form is the path for orders that predate split payments:
     * they carry one payment for the whole order total on the order row, and no
     * {@code order_payment} line at all.
     */
    @Transactional
    public CustomerOrder markPaymentDeclined(String orderId, PaymentOutcome payment) {
        return markPaymentDeclined(orderId, null, payment);
    }

    /**
     * The payment service refused one merchant of this order.
     *
     * <p>Both facts are written in one transaction: the merchant's line is FAILED
     * (nothing moved for them) and the order records the refusal, so the state a
     * support engineer reads and the per-merchant progress the recovery job reads
     * can never disagree.
     */
    @Transactional
    public CustomerOrder markPaymentDeclined(String orderId, String merchantId, PaymentOutcome payment) {
        CustomerOrder order = lock(orderId);
        if (merchantId != null) {
            requirePayment(orderId, merchantId).markFailed(payment);
        }
        order.markPaymentDeclined(payment, OrderFailure.of(OrderErrorCode.PAYMENT_DECLINED, describeDecline(payment)));
        return order;
    }

    /** Closes the saga of a paid order (stock committed). */
    @Transactional
    public CustomerOrder markStockCommitted(String orderId) {
        CustomerOrder order = lock(orderId);
        order.markSagaCompleted();
        log.info("order {} is complete: stock committed", order.getOrderNumber());
        return order;
    }

    /**
     * Cancels with an error code attached.
     *
     * <p>Idempotent by status: a second call is an at-least-once redelivery of an
     * event we already processed, and it must not publish a second
     * {@code order.cancelled}.
     */
    @Transactional
    public CustomerOrder markCancelled(String orderId, OrderFailure failure, String actor, boolean stockReleaseSettled) {
        return cancelInternal(orderId, failure.encode(), actor, stockReleaseSettled);
    }

    /** Cancels with a plain reason (a customer action, or an abandoned checkout). */
    @Transactional
    public CustomerOrder markCancelled(String orderId, String reason, String actor, boolean stockReleaseSettled) {
        return cancelInternal(orderId, reason, actor, stockReleaseSettled);
    }

    /** The stock hold came back to the shelf: the cancelled order owes nothing. */
    @Transactional
    public CustomerOrder markStockReleased(String orderId) {
        CustomerOrder order = lock(orderId);
        if (order.isInSagaState(SagaState.STOCK_RELEASE_PENDING)) {
            order.markSagaCompleted();
            log.info("order {} released its stock hold; the compensation is settled", order.getOrderNumber());
        }
        return order;
    }

    private CustomerOrder cancelInternal(String orderId, String storedReason, String actor, boolean stockReleaseSettled) {
        CustomerOrder order = lock(orderId);
        if (order.isCancelled()) {
            log.info("order {} is already cancelled; nothing to do", order.getOrderNumber());
            return order;
        }
        OrderStatus previous = order.getStatus();
        order.cancelByUser(storedReason, stockReleaseSettled);
        historyRepository.save(OrderStatusHistory.of(orderId, previous, OrderStatus.CANCELLED, storedReason, actor));
        append(order, KafkaTopics.Events.ORDER_CANCELLED, itemCount(orderId));
        return order;
    }

    /** Records a diagnostic reason without moving the order. */
    @Transactional
    public CustomerOrder recordNote(String orderId, String reason) {
        CustomerOrder order = lock(orderId);
        order.recordNote(reason);
        return order;
    }

    // ------------------------------------------------------------------ reads

    /** The order a retried checkout already produced, if any. */
    @Transactional(readOnly = true)
    public Optional<CustomerOrder> findByCheckoutKey(String idempotencyKey) {
        return orderRepository.findByIdempotencyKey(idempotencyKey);
    }

    @Transactional(readOnly = true)
    public Optional<CustomerOrder> findOrder(String orderId) {
        return orderRepository.findById(orderId);
    }

    /**
     * Resolves an order from a payment id, for an event that did not name one.
     *
     * <p>Two places can hold it: the order row (a single-payment order, and every
     * order created before split payments) and the per-merchant payment lines of a
     * split order whose payments were still in flight when the order row was last
     * written.
     */
    @Transactional(readOnly = true)
    public Optional<CustomerOrder> findOrderByPaymentId(String paymentId) {
        if (paymentId == null) {
            return Optional.empty();
        }
        return orderRepository.findFirstByPaymentId(paymentId)
                .or(() -> paymentRepository.findFirstByPaymentId(paymentId)
                        .flatMap(payment -> orderRepository.findById(payment.getOrderId())));
    }

    @Transactional(readOnly = true)
    public CustomerOrder requireOrder(String orderId) {
        return orderRepository.findById(orderId)
                .orElseThrow(() -> DomainException.of(OrderErrorCode.ORDER_NOT_FOUND, "order {} not found", orderId)
                        .withDetail("orderId", orderId));
    }

    @Transactional(readOnly = true)
    public List<OrderItem> itemsOf(String orderId) {
        return orderItemRepository.findByOrderIdOrderByIdAsc(orderId);
    }

    /** Orders that have not moved for longer than the saga timeout. */
    @Transactional(readOnly = true)
    public List<CustomerOrder> findStuckPending(Instant olderThan, int limit) {
        return orderRepository.findStuck(OrderStatus.PENDING_PAYMENT, olderThan, PageRequest.of(0, limit));
    }

    /** Orders whose saga still owes a commit or a release. */
    @Transactional(readOnly = true)
    public List<CustomerOrder> findInSagaStates(Collection<SagaState> states, Instant olderThan, int limit) {
        return orderRepository.findInSagaStates(states, olderThan, PageRequest.of(0, limit));
    }

    // ------------------------------------------------------------------ internals

    /**
     * Loads an order with a row lock.
     *
     * <p>The lock, not the {@code @Version} field, is what serialises the four
     * writers this table has (the request thread, the Kafka listener, the cancel
     * endpoint and the recovery job). It is held for the write only: remote calls
     * happen after the transaction commits.
     */
    private CustomerOrder lock(String orderId) {
        return orderRepository.findByIdForUpdate(orderId)
                .orElseThrow(() -> DomainException.of(OrderErrorCode.ORDER_NOT_FOUND, "order {} not found", orderId)
                        .withDetail("orderId", orderId));
    }

    private int itemCount(String orderId) {
        return (int) orderItemRepository.countByOrderId(orderId);
    }

    /**
     * Queues a lifecycle event.
     *
     * <p>Called inside the transaction that moved the order: {@code OutboxWriter}
     * warns loudly when it is not, because an event that is not committed with its
     * state change is exactly the bug the outbox exists to prevent.
     */
    private void append(CustomerOrder order, String eventType, int itemCount) {
        outboxWriter.append(KafkaTopics.ORDER_EVENTS, eventType, AGGREGATE_TYPE, order.getId(), order.getVersion(),
                new OrderEvents.OrderLifecycle(
                        order.getId(),
                        order.getOrderNumber(),
                        order.getUserId(),
                        order.getStatus().name(),
                        order.currencyCode(),
                        order.getSubtotalMinor(),
                        order.getDeliveryFeeMinor(),
                        order.getTotalMinor(),
                        order.getPaymentId(),
                        itemCount,
                        Instant.now()));
    }

    private static String describeDecline(PaymentOutcome payment) {
        String reason = payment.failureReason() != null && !payment.failureReason().isBlank()
                ? payment.failureReason()
                : "the payment was declined";
        return payment.failureCode() == null ? reason : "%s (%s)".formatted(reason, payment.failureCode());
    }
}
