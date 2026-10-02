package kz.taxi.order.infrastructure.client;

import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.Optional;

/**
 * The payment service, as the checkout saga needs it.
 *
 * <p>The identity of the caller travels automatically: the auto-configured
 * {@code RestClient.Builder} carries {@code Authorization},
 * {@code X-Internal-Token} and {@code X-Correlation-Id} on every call, so a
 * checkout pays from the account of the user who started it and no header is added
 * by hand here.
 *
 * <p>The classification of a failure is the whole point of this class:
 * <ul>
 *   <li><b>A refusal</b> — the service answered politely, e.g. {@code 422
 *       INSUFFICIENT_FUNDS} — becomes {@link PaymentStatus#FAILED}. Nothing moved,
 *       so the saga releases the stock and cancels the order.</li>
 *   <li><b>An unanswered call</b> — timeout, connection failure, 5xx, a lost
 *       answer, or a 409 on the idempotency key (which means an earlier attempt
 *       exists) — throws. The saga records PAYMENT_UNKNOWN and leaves the order in
 *       PENDING_PAYMENT: money may have moved, and only a reconciliation can
 *       decide.</li>
 * </ul>
 */
@Slf4j
public class PaymentClient {

    /** Header the payment service uses to make a charge idempotent. */
    public static final String IDEMPOTENCY_HEADER = "Idempotency-Key";

    private final RestClient client;
    private final DownstreamErrors errors;

    public PaymentClient(RestClient client, DownstreamErrors errors) {
        this.client = client;
        this.errors = errors;
    }

    /**
     * Charges the customer's account to the merchant.
     *
     * @param idempotencyKey deterministic key derived from the order id, so a
     *                       retried checkout cannot charge twice
     */
    public PaymentOutcome createMerchantPayment(PaymentDtos.MerchantPaymentRequest request, String idempotencyKey) {
        try {
            PaymentDtos.PaymentResponse response = client.post()
                    .uri("/api/v1/payments/merchant")
                    .header(IDEMPOTENCY_HEADER, idempotencyKey)
                    .body(request)
                    .retrieve()
                    .body(PaymentDtos.PaymentResponse.class);
            if (response == null) {
                return PaymentOutcome.unknown(null, "the payment service answered with an empty body");
            }
            return toOutcome(response);
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (problem.isIndeterminate()) {
                // A 5xx, a conflict on our idempotency key, a rate limit: an earlier
                // attempt may exist and may have moved money. Never a decline.
                throw errors.answeredWithError(OrderErrorCode.PAYMENT_SERVICE_ERROR,
                        "payment", "charge the customer", problem);
            }
            return PaymentOutcome.declined(problem.code(), problem.summary());
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("payment", "charge the customer", unavailable);
        }
    }

    /** The payment of an order, by order id. Empty when the order was never charged. */
    public Optional<PaymentOutcome> findByOrderId(String orderId) {
        return get("/api/v1/payments/by-order/{id}", orderId, "read the payment of the order");
    }

    /** The payment by its own id: the fallback when the order id lookup finds nothing. */
    public Optional<PaymentOutcome> findByPaymentId(String paymentId) {
        return get("/api/v1/payments/{id}", paymentId, "read the payment");
    }

    /**
     * Gives the money back.
     *
     * <p>Called when a customer cancels an order whose payment was already captured.
     * The key is derived from the order id, so a retried cancellation refunds once;
     * a failure here is loud, because the alternative — cancelling an order the
     * customer paid for — loses their money.
     */
    public void refund(String paymentId, String reason, String idempotencyKey) {
        try {
            client.post()
                    .uri("/api/v1/payments/{id}/refund", paymentId)
                    .header(IDEMPOTENCY_HEADER, idempotencyKey)
                    .body(new PaymentDtos.RefundRequest(reason))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            throw errors.answeredWithError(OrderErrorCode.PAYMENT_SERVICE_ERROR,
                    "payment", "refund the payment", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("payment", "refund the payment", unavailable);
        }
    }

    private Optional<PaymentOutcome> get(String uriTemplate, String id, String operation) {
        try {
            return Optional.ofNullable(client.get()
                    .uri(uriTemplate, id)
                    .retrieve()
                    .body(PaymentDtos.PaymentResponse.class))
                    .map(this::toOutcome);
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (problem.httpStatus() == 404) {
                return Optional.empty();
            }
            // 401/403 land here too, and they must never be read as "no payment":
            // the recovery job skips the order instead of cancelling it.
            throw errors.answeredWithError(OrderErrorCode.PAYMENT_SERVICE_ERROR, "payment", operation, problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer("payment", operation, unavailable);
        }
    }

    private PaymentOutcome toOutcome(PaymentDtos.PaymentResponse response) {
        PaymentStatus status = PaymentStatus.parse(response.status());
        if (status.isUnknown()) {
            log.warn("payment {} of order {} has unrecognised status '{}'; treating the outcome as unknown",
                    response.paymentId(), response.orderId(), response.status());
        }
        // The platform fee is the payment service's own number and travels with the
        // answer: what the payer was debited nothing else in this service can compute.
        return new PaymentOutcome(response.paymentId(), response.paymentNumber(), status,
                response.amountMinor(), response.feeMinor(), response.totalMinor(),
                response.currency(), response.failureCode(), response.failureReason());
    }

    /** Builds the request for an order's merchant payment. */
    public static PaymentDtos.MerchantPaymentRequest merchantPayment(String sourceAccountId,
                                                                   String merchantId,
                                                                   long amountMinor,
                                                                   String currency,
                                                                   String description,
                                                                   String orderId) {
        return new PaymentDtos.MerchantPaymentRequest(sourceAccountId, merchantId, amountMinor, currency,
                description, orderId);
    }
}
