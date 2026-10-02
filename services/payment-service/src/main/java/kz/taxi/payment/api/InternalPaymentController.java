package kz.taxi.payment.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.application.PaymentQueryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service read API.
 *
 * <p>Reached only through the platform's internal-token filter (the path contains
 * {@code /internal/}) and never routed by the public gateway. There is no user
 * token here on purpose: the callers are order-service's Kafka listener and its
 * checkout recovery job, and neither of them is a user — a background process
 * cannot present an owner's credentials, yet it must be able to find out whether a
 * payment it is reconciling actually exists and how it ended.
 *
 * <p>Read-only by design: money is only ever moved by a request that carries a
 * user's identity, or by the saga's own recovery job inside this service.
 */
@RestController
@RequestMapping("/api/v1/payments/internal")
@Tag(name = "Payments (internal)",
        description = "Called by order-service for reconciliation; protected by X-Internal-Token")
public class InternalPaymentController {

    private final PaymentQueryService queries;

    public InternalPaymentController(PaymentQueryService queries) {
        this.queries = queries;
    }

    @GetMapping("/{paymentId}")
    @Operation(summary = "Read a payment without a user token",
            description = "Same field names as the payment.* events, so a consumer can compare what it was "
                    + "told with what is stored. 404 when no such payment exists.")
    public PaymentDtos.PaymentResponse get(@PathVariable String paymentId) {
        return queries.getInternal(paymentId);
    }

    @GetMapping("/by-order/{orderId}")
    @Operation(summary = "Find the payment of a marketplace order without a user token",
            description = "Returns the settled payment of the order (newest first when an order somehow has "
                    + "more than one), 404 when the order was never paid. This is the endpoint a checkout "
                    + "recovery job uses after a timeout.")
    public PaymentDtos.PaymentResponse byOrder(@PathVariable String orderId) {
        return queries.byOrderInternal(orderId);
    }
}
