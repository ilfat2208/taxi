package kz.taxi.payment.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.application.PaymentQueryService;
import kz.taxi.payment.application.PaymentSagaService;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.infrastructure.PaymentProperties;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Customer-facing payment API.
 *
 * <p>Thin by design: no business rule, no transaction boundary and no status code
 * invented here. The one thing a controller <em>does</em> own is idempotency — the
 * mutating endpoints require an {@code Idempotency-Key} and wrap the use case in
 * {@link IdempotencyGuard}, so a retried request replays the stored response
 * instead of moving money twice. (Wrapping here rather than inside the use case is
 * what makes the guard see the request body it has to hash.)
 */
@RestController
@RequestMapping("/api/v1/payments")
@Tag(name = "Payments", description = "Transfers, merchant payments and refunds; money moves synchronously")
public class PaymentController {

    private final PaymentSagaService payments;
    private final PaymentQueryService queries;
    private final CurrentUser currentUser;
    private final IdempotencyGuard idempotencyGuard;
    private final PaymentProperties properties;

    public PaymentController(PaymentSagaService payments,
                             PaymentQueryService queries,
                             CurrentUser currentUser,
                             IdempotencyGuard idempotencyGuard,
                             PaymentProperties properties) {
        this.payments = payments;
        this.queries = queries;
        this.currentUser = currentUser;
        this.idempotencyGuard = idempotencyGuard;
        this.properties = properties;
    }

    /**
     * Payment methods a client may offer — and which of them actually work.
     *
     * <p>Public on purpose: a checkout screen draws its payment options before the person
     * has entered anything, and a client app cannot hardcode a list that the platform
     * changes. The unimplemented method is returned rather than omitted, because
     * "card is coming" and "card does not exist" are different products, and only the
     * server knows which one is true today.
     */
    @GetMapping("/methods")
    @Operation(summary = "Payment methods",
            description = "Public list of methods with their availability. Fees are the platform's own rates "
                    + "in basis points, taken from the same configuration the fee calculator uses.")
    public PaymentDtos.PaymentMethodsResponse methods() {
        return new PaymentDtos.PaymentMethodsResponse(
                kz.taxi.common.core.money.Currency.KZT.name(),
                List.of(
                        new PaymentDtos.PaymentMethodView("BALANCE", "Баланс счёта ORTA", true,
                                "Списание с баланса счёта происходит внутри платформы: эквайринг не нужен"),
                        new PaymentDtos.PaymentMethodView("CARD", "Банковская карта", false,
                                "Эквайринг не подключён: в этой версии деньги двигаются только между счетами платформы")),
                (int) properties.getMerchantFeeBp(),
                (int) properties.getTransferFeeBp(),
                "комиссии — конфигурация сервиса (taxi.payments.*), в базисных пунктах: "
                        + "150 = 1,5 % с мерчантского платежа, переводы между людьми без комиссии");
    }

    @PostMapping("/transfers")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Send money to another account",
            description = "Reserves the amount on the source account, moves it to the recipient and returns "
                    + "the completed payment. The recipient is addressed by phone (resolved to their active "
                    + "account) or by account id. Requires the Idempotency-Key header; retrying with the same "
                    + "key and body returns the stored response.")
    public PaymentDtos.PaymentResponse transfer(@Valid @RequestBody PaymentDtos.TransferRequest request) {
        String key = IdempotencyGuard.requireKey();
        return idempotencyGuard.execute(key, request, PaymentDtos.PaymentResponse.class,
                () -> payments.transfer(currentUser.require(), request, key)).body();
    }

    @PostMapping("/merchant")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Pay a marketplace merchant",
            description = "Called by order-service on checkout. The payer is debited amount + fee (basis points "
                    + "of the amount) and the money settles to the platform suspense account; order-service "
                    + "settles the merchant from the payment.completed event. Returns a payment in a terminal "
                    + "state: COMPLETED when the money moved, FAILED (with a reason) when it did not.")
    public PaymentDtos.PaymentResponse merchantPayment(
            @Valid @RequestBody PaymentDtos.MerchantPaymentRequest request) {
        String key = IdempotencyGuard.requireKey();
        return idempotencyGuard.execute(key, request, PaymentDtos.PaymentResponse.class,
                () -> payments.merchantPayment(currentUser.require(), request, key)).body();
    }

    @PostMapping("/{id}/refund")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Refund a completed payment, fully or partially",
            description = "The refund is credited to the account the money came from, referenced by the refund "
                    + "id, which is what makes a retried refund safe. Cumulative refunds can never exceed the "
                    + "payment amount; refunding the whole amount reverses the payment. The owner of the payment "
                    + "and an ADMIN may refund; SUPPORT reads payments but cannot move money, which is the rule "
                    + "the admin panel renders as read-only for that role. Requires the "
                    + "Idempotency-Key header.")
    public PaymentDtos.RefundResponse refund(@PathVariable String id,
                                             @Valid @RequestBody PaymentDtos.RefundRequest request) {
        String key = IdempotencyGuard.requireKey();
        return idempotencyGuard.execute(key, request, PaymentDtos.RefundResponse.class,
                () -> payments.refund(currentUser.require(), id, request, key)).body();
    }

    @GetMapping("/{id}")
    @Operation(summary = "One payment with its full transition history",
            description = "Owner, SUPPORT or ADMIN only; anyone else gets 403.")
    public PaymentDtos.PaymentDetailsResponse get(@PathVariable String id) {
        return queries.get(currentUser.require(), id);
    }

    @GetMapping
    @Operation(summary = "List payments, newest first",
            description = "The caller's own payments; an operator (ADMIN or SUPPORT) sees every payment. Filter by "
                    + "status to build an \"in flight\" or \"failed\" view.")
    public PageResponse<PaymentDtos.PaymentResponse> list(
            @Parameter(description = "Zero-based page index") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size, 1..100") @RequestParam(defaultValue = "20") int size,
            @Parameter(description = "Filter by payment status") @RequestParam(required = false) PaymentStatus status) {
        return queries.list(currentUser.require(), status, page, size);
    }

    @GetMapping("/{id}/refunds")
    @Operation(summary = "Refunds of a payment, oldest first")
    public List<PaymentDtos.RefundResponse> refunds(@PathVariable String id) {
        return queries.refunds(currentUser.require(), id);
    }

    @GetMapping("/by-order/{orderId}")
    @Operation(summary = "The payment of a marketplace order",
            description = "Used by order-service to recover a checkout whose response it never received: it "
                    + "returns the settled payment of the order, or 404 when the order was never paid. The "
                    + "background variant of this lookup lives under /internal/by-order/{orderId}, which needs "
                    + "no user token.")
    public PaymentDtos.PaymentResponse byOrder(@PathVariable String orderId) {
        return queries.byOrder(currentUser.require(), orderId);
    }
}
