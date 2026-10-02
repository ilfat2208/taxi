package kz.taxi.payment.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.infrastructure.PaymentProperties;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.PaymentTransitionRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Read side of the payment API.
 *
 * <p>Reads never call the account service: the payment row already carries the
 * owner, the amounts and the outcome, and asking for a balance on every page view
 * would make the payment service as slow and as fragile as the service it is
 * trying to isolate itself from.
 *
 * <p>Authorization is decided here, next to the data, and never in a controller:
 * the owner sees their payment, an operator (SUPPORT/ADMIN) sees anybody's, and
 * everyone else gets 403.
 */
@Service
@Slf4j
public class PaymentQueryService {

    private final PaymentRepository payments;
    private final PaymentTransitionRepository transitions;
    private final RefundRepository refunds;
    private final PaymentMapper mapper;
    private final PaymentProperties properties;

    public PaymentQueryService(PaymentRepository payments,
                               PaymentTransitionRepository transitions,
                               RefundRepository refunds,
                               PaymentMapper mapper,
                               PaymentProperties properties) {
        this.payments = payments;
        this.transitions = transitions;
        this.refunds = refunds;
        this.mapper = mapper;
        this.properties = properties;
    }

    @Transactional(readOnly = true)
    public PaymentDtos.PaymentDetailsResponse get(AuthenticatedUser caller, String paymentId) {
        Payment payment = require(paymentId);
        PaymentAccess.require(caller, payment);
        return mapper.toDetails(payment, transitions.findByPaymentIdOrderByCreatedAtAsc(paymentId));
    }

    /** Newest first; administrators see every payment, everybody else only their own. */
    @Transactional(readOnly = true)
    public PageResponse<PaymentDtos.PaymentResponse> list(AuthenticatedUser caller,
                                                          PaymentStatus status,
                                                          int page,
                                                          int size) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), clamp(size));
        Page<Payment> result;
        if (caller != null && caller.isAdmin()) {
            result = status == null
                    ? payments.findAllByOrderByCreatedAtDesc(pageable)
                    : payments.findByStatusOrderByCreatedAtDesc(status, pageable);
        } else {
            String owner = caller == null ? null : caller.userId();
            if (owner == null) {
                throw DomainException.unauthorized("authentication required");
            }
            result = status == null
                    ? payments.findByOwnerUserIdOrderByCreatedAtDesc(owner, pageable)
                    : payments.findByOwnerUserIdAndStatusOrderByCreatedAtDesc(owner, status, pageable);
        }
        return PageResponse.of(result.getContent(), result.getNumber(), result.getSize(),
                result.getTotalElements(), mapper::toResponse);
    }

    @Transactional(readOnly = true)
    public List<PaymentDtos.RefundResponse> refunds(AuthenticatedUser caller, String paymentId) {
        Payment payment = require(paymentId);
        PaymentAccess.require(caller, payment);
        return refunds.findByPaymentIdOrderByCreatedAtAsc(paymentId).stream().map(mapper::toResponse).toList();
    }

    /**
     * The payment of a marketplace order, used by order-service when it recovers a
     * checkout and does not know whether its own call ever got through.
     *
     * <p>When an order has more than one payment row (the same order paid twice with
     * different idempotency keys) the settled one wins and the newest breaks a tie —
     * returning a still-PENDING duplicate would make the caller wait for something
     * that is never going to happen.
     */
    @Transactional(readOnly = true)
    public PaymentDtos.PaymentResponse byOrder(AuthenticatedUser caller, String orderId) {
        Payment payment = selectOrderPayment(orderId);
        PaymentAccess.require(caller, payment);
        return mapper.toResponse(payment);
    }

    // ------------------------------------------------------------------ service-to-service reads

    /**
     * A payment read by another service, not by a person.
     *
     * <p>No owner check: these paths carry no user token (a Kafka listener or a
     * scheduled recovery job has no identity), and the credential is the
     * {@code X-Internal-Token} the platform's filter validates before this method is
     * ever reached. The response is the flat payment — exactly the field names of the
     * {@code payment.*} events — so a consumer can reconcile what it was told with
     * what actually happened in one parser.
     */
    @Transactional(readOnly = true)
    public PaymentDtos.PaymentResponse getInternal(String paymentId) {
        return mapper.toResponse(require(paymentId));
    }

    /** The payment of an order, for a service that has no user context. */
    @Transactional(readOnly = true)
    public PaymentDtos.PaymentResponse byOrderInternal(String orderId) {
        return mapper.toResponse(selectOrderPayment(orderId));
    }

    /**
     * Every payment of one order — one per merchant after checkout was split.
     *
     * <p>An order used to be paid by a single merchant payment; a multi-merchant cart
     * produces several, and "the first one" is no longer the whole story. The
     * user-facing variant returns only the payments the caller may see and 404s when
     * that is none of them, so an order id alone reveals nothing to a stranger.
     */
    @Transactional(readOnly = true)
    public List<PaymentDtos.PaymentResponse> byOrderAll(AuthenticatedUser caller, String orderId) {
        List<Payment> visible = payments.findByOrderIdOrderByCreatedAtAsc(orderId).stream()
                .filter(payment -> canRead(caller, payment))
                .toList();
        if (visible.isEmpty()) {
            throw DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                    "no payment exists for order {} that {} may read", orderId, caller.userId());
        }
        return visible.stream().map(mapper::toResponse).toList();
    }

    /**
     * The same list for a workload: order-service's recovery job has no user token and
     * must see every merchant payment of an order to finalize the ones that succeeded
     * and refund the others.
     */
    @Transactional(readOnly = true)
    public List<PaymentDtos.PaymentResponse> byOrderAllInternal(String orderId) {
        List<Payment> orderPayments = payments.findByOrderIdOrderByCreatedAtAsc(orderId);
        if (orderPayments.isEmpty()) {
            throw DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                    "no payment exists for order {}", orderId);
        }
        return orderPayments.stream().map(mapper::toResponse).toList();
    }

    /**
     * Visibility rule of a payment list, expressed with the same primitive as a single
     * read: {@link PaymentAccess#require} is the authority on "may this caller see this
     * payment", and a filter is just that question asked without an exception.
     */
    private boolean canRead(AuthenticatedUser caller, Payment payment) {
        try {
            PaymentAccess.require(caller, payment);
            return true;
        } catch (RuntimeException notVisible) {
            return false;
        }
    }

    private Payment selectOrderPayment(String orderId) {        List<Payment> candidates = payments.findByOrderIdOrderByCreatedAtDesc(orderId);
        if (candidates.isEmpty()) {
            throw DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                    "no payment exists for order {}", orderId);
        }
        return candidates.stream()
                .filter(candidate -> candidate.getStatus().isSettled())
                .findFirst()
                .orElse(candidates.get(0));
    }

    private Payment require(String paymentId) {
        return payments.findById(paymentId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "payment {} not found", paymentId));
    }

    private int clamp(int size) {
        int maximum = Math.max(properties.getPageSizeMax(), 1);
        int requested = size <= 0 ? properties.getPageSizeDefault() : size;
        return Math.min(Math.max(requested, 1), maximum);
    }
}
