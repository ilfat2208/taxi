package kz.taxi.payment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentFees;
import kz.taxi.payment.domain.PaymentIntent;
import kz.taxi.payment.domain.PaymentType;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.domain.RequestHash;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.PaymentProperties;
import kz.taxi.payment.infrastructure.PaymentRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Optional;

/**
 * The saga: it moves money through the account service and never holds a database
 * transaction open while doing it.
 *
 * <h2>Ordering of a P2P transfer</h2>
 * <ol>
 *   <li>read the source account through the <em>public</em> endpoint — the caller's
 *       own token travels with the call, so the account service applies the same
 *       ownership rule and a 403 is authoritative. This is why a payment can never
 *       be used to spend somebody else's money;</li>
 *   <li>resolve the recipient (by phone or by the given account id) — before any
 *       row exists, because a recipient that does not exist is a client error, not
 *       a saga;</li>
 *   <li>reject a self-transfer before reserving anything;</li>
 *   <li>create the payment as INITIATED, commit, and publish {@code payment.initiated};</li>
 *   <li>commit INITIATED -&gt; PENDING, <em>then</em> ask for the hold. If the process
 *       dies right here the payment is findable and the recovery job can ask the
 *       account service whether funds were reserved;</li>
 *   <li>commit the hold id, <em>then</em> commit the "capture requested" marker,
 *       <em>then</em> capture. Both markers exist so the recovery job never has to
 *       guess whether money moved;</li>
 *   <li>commit COMPLETED and {@code payment.completed} together.</li>
 * </ol>
 *
 * <h2>Compensation</h2>
 * <p>A capture that fails after a successful hold gives the money back — but only
 * after asking the account service what actually happened to the hold, because a
 * timeout on the response is not a failed capture. Three outcomes, all
 * deterministic:
 * <ul>
 *   <li>hold CAPTURED: the money moved, so the payment is completed (the failure was
 *       the answer, not the movement);</li>
 *   <li>hold still ACTIVE: the reservation is released, then the payment is failed;</li>
 *   <li>hold unreadable (the account service is unreachable): nothing is decided —
 *       the payment stays PENDING with its markers intact and the recovery job
 *       resolves it later from the hold's true state.</li>
 * </ul>
 * The order inside the compensation matters too: the release happens before the
 * payment is failed, so a crash in between leaves a PENDING payment with no active
 * hold, which the recovery job resolves as a failure. The opposite order would
 * leave a failed payment whose money is still reserved until the hold expires.
 */
@Service
@Slf4j
public class PaymentSagaService {

    private static final int MAX_REASON_LENGTH = 400;

    private final AccountServiceClient accounts;
    private final PaymentStateService state;
    private final PaymentRepository payments;
    private final PaymentMapper mapper;
    private final ObjectMapper objectMapper;
    private final PaymentProperties properties;

    public PaymentSagaService(AccountServiceClient accounts,
                              PaymentStateService state,
                              PaymentRepository payments,
                              PaymentMapper mapper,
                              ObjectMapper objectMapper,
                              PaymentProperties properties) {
        this.accounts = accounts;
        this.state = state;
        this.payments = payments;
        this.mapper = mapper;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ transfers

    /**
     * Person-to-person transfer: hold on the payer, capture onto the recipient.
     *
     * <p>Synchronous by design — the caller learns the outcome (or the reason it was
     * refused) from this response, and the Kafka events exist for everyone else.
     */
    public PaymentDtos.PaymentResponse transfer(AuthenticatedUser caller,
                                                PaymentDtos.TransferRequest request,
                                                String idempotencyKey) {
        requirePositiveAmount(request.amountMinor());
        Money amount = Money.ofMinor(request.amountMinor(), request.currency());

        AccountServiceClient.AccountSnapshot source = accounts.getAccount(request.sourceAccountId());
        requireCallerMayUse(caller, source);
        requireCurrency(source.currency(), request.currency(), "source account");

        String targetAccountId = resolveTarget(request);
        if (targetAccountId.equals(source.accountId())) {
            throw DomainException.of(PaymentErrorCode.SELF_TRANSFER_NOT_ALLOWED,
                    "account {} cannot transfer to itself", source.accountId());
        }

        PaymentFees.FeeBreakdown money = PaymentFees.forType(PaymentType.P2P_TRANSFER, amount,
                properties.getTransferFeeBp(), properties.getMerchantFeeBp());
        PaymentIntent intent = new PaymentIntent(PaymentType.P2P_TRANSFER, source.ownerUserId(), source.accountId(),
                targetAccountId, null, null, request.description(), idempotencyKey, requestHash(request),
                CorrelationContext.get());
        Payment payment = state.initiate(intent, money);

        return runSaga(payment, targetAccountId,
                describe(request.description(), "P2P transfer " + payment.getPaymentNumber()));
    }

    /**
     * Marketplace payment, driven by order-service.
     *
     * <p>The money settles to the platform suspense account (the capture has no
     * target account) and goes out to the merchant through order-service, which
     * reads {@code amountMinor}, {@code feeMinor} and {@code orderId} from
     * {@code payment.completed}. The payer is debited {@code amount + fee}, which is
     * why the hold is for the total.
     */
    public PaymentDtos.PaymentResponse merchantPayment(AuthenticatedUser caller,
                                                       PaymentDtos.MerchantPaymentRequest request,
                                                       String idempotencyKey) {
        requirePositiveAmount(request.amountMinor());
        Money amount = Money.ofMinor(request.amountMinor(), request.currency());

        AccountServiceClient.AccountSnapshot source = accounts.getAccount(request.sourceAccountId());
        requireCallerMayUse(caller, source);
        requireCurrency(source.currency(), request.currency(), "source account");

        PaymentFees.FeeBreakdown money = PaymentFees.forType(PaymentType.MERCHANT_PAYMENT, amount,
                properties.getTransferFeeBp(), properties.getMerchantFeeBp());
        PaymentIntent intent = new PaymentIntent(PaymentType.MERCHANT_PAYMENT, source.ownerUserId(), source.accountId(),
                null, request.merchantId(), request.orderId(), request.description(), idempotencyKey,
                requestHash(request), CorrelationContext.get());
        Payment payment = state.initiate(intent, money);

        return runSaga(payment, null,
                describe(request.description(), "merchant payment " + payment.getPaymentNumber()
                        + " for order " + request.orderId()));
    }

    // ------------------------------------------------------------------ refunds

    /**
     * Refunds a completed payment, fully or partially.
     *
     * <p>A refund is not a reversal of the capture (the ledger entry stays as it
     * was); it is a new credit against the payer, referenced by the refund id, which
     * is what makes a retried refund safe. When the refunds add up to the whole
     * payment, the payment itself becomes REVERSED.
     */
    public PaymentDtos.RefundResponse refund(AuthenticatedUser caller,
                                             String paymentId,
                                             PaymentDtos.RefundRequest request,
                                             String idempotencyKey) {
        PaymentStateService.RefundStart start = state.openRefund(caller, paymentId, request.amountMinor(),
                request.reason(), idempotencyKey);
        Refund refund = start.refund();
        if (start.completed()) {
            log.debug("refund {} was already completed, replaying it", refund.getId());
            return mapper.toResponse(refund);
        }

        Payment payment = payments.findById(paymentId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "payment {} not found", paymentId));

        try {
            accounts.credit(new AccountServiceClient.CreditRequest(
                    payment.getSourceAccountId(),
                    refund.getAmountMinor(),
                    refund.getCurrency(),
                    AccountServiceClient.REFERENCE_TYPE_REFUND,
                    refund.getId(),
                    PaymentType.REFUND.ledgerOperation(),
                    "refund of payment " + payment.getPaymentNumber()));
        } catch (DomainException creditFailure) {
            if (isAmbiguous(creditFailure)) {
                // The credit may or may not have landed. The refund stays INITIATED:
                // its id is already the reference of that credit, so a later attempt
                // (a client retry with the same key, or the recovery job) costs
                // nothing, while a wrong FAILED would let the same money be refunded
                // a second time.
                log.warn("refund {} of payment {} could not be confirmed ({}); leaving it INITIATED for a retry",
                        refund.getId(), payment.getPaymentNumber(), creditFailure.getMessage());
                throw creditFailure;
            }
            state.failRefund(refund.getId(), creditFailure.getMessage());
            throw creditFailure;
        }

        return mapper.toResponse(state.completeRefund(refund.getId()));
    }

    // ------------------------------------------------------------------ saga driver

    private PaymentDtos.PaymentResponse runSaga(Payment payment, String targetAccountId, String description) {
        String paymentId = payment.getId();
        String operation = payment.getType().ledgerOperation();

        // The marker is committed first: after this line a crash is recoverable.
        state.markPending(paymentId);

        AccountServiceClient.HoldSnapshot hold;
        try {
            hold = accounts.placeHold(new AccountServiceClient.HoldRequest(
                    payment.getSourceAccountId(),
                    payment.getTotalMinor(),
                    payment.getCurrency(),
                    AccountServiceClient.REFERENCE_TYPE_PAYMENT,
                    paymentId,
                    // The payment id is the hold's idempotency key: a retried hold
                    // request returns the same reservation instead of reserving twice.
                    paymentId,
                    description));
        } catch (RuntimeException holdFailure) {
            DomainException refused = asDomainException(holdFailure, "reserve funds for payment "
                    + payment.getPaymentNumber());
            failPayment(paymentId, refused);
            throw refused;
        }

        state.recordHold(paymentId, hold.holdId());
        state.beginCapture(paymentId, hold.holdId());

        AccountServiceClient.CaptureResult capture;
        try {
            capture = accounts.capture(hold.holdId(), new AccountServiceClient.CaptureRequest(
                    targetAccountId,
                    AccountServiceClient.REFERENCE_TYPE_PAYMENT,
                    paymentId,
                    operation,
                    description));
        } catch (RuntimeException captureFailure) {
            return compensate(payment, hold, captureFailure);
        }

        Payment completed = state.markCompleted(paymentId);
        log.info("payment {} completed as transaction {}", completed.getPaymentNumber(), capture.transactionId());
        return mapper.toResponse(completed);
    }

    private PaymentDtos.PaymentResponse compensate(Payment payment,
                                                   AccountServiceClient.HoldSnapshot hold,
                                                   RuntimeException captureFailure) {
        DomainException failure = asDomainException(captureFailure,
                "move reserved funds for payment " + payment.getPaymentNumber());
        String paymentId = payment.getId();

        Optional<AccountServiceClient.HoldSnapshot> current;
        try {
            current = accounts.findHold(hold.holdId());
        } catch (DomainException cannotVerify) {
            log.error("payment {}: capture of hold {} failed ({}) and the hold cannot be read back ({});"
                            + " leaving the payment PENDING for the recovery job",
                    payment.getPaymentNumber(), hold.holdId(), failure.getMessage(), cannotVerify.getMessage());
            throw failure;
        }

        if (current.map(AccountServiceClient.HoldSnapshot::state)
                .orElse(AccountServiceClient.HoldState.UNKNOWN) == AccountServiceClient.HoldState.CAPTURED) {
            log.warn("payment {}: capture reported '{}' but hold {} is CAPTURED; completing the payment",
                    payment.getPaymentNumber(), failure.getMessage(), hold.holdId());
            try {
                return mapper.toResponse(state.markCompleted(paymentId));
            } catch (RuntimeException alreadyResolved) {
                log.warn("payment {} could not be completed after all: {}", paymentId, alreadyResolved.getMessage());
                throw failure;
            }
        }

        try {
            state.beginRelease(paymentId, hold.holdId(), "capture failed: " + failure.getMessage());
        } catch (RuntimeException cannotMark) {
            log.debug("payment {}: could not record the release intent: {}", paymentId, cannotMark.getMessage());
        }
        try {
            accounts.release(hold.holdId(), "payment " + payment.getPaymentNumber() + " failed: "
                    + failure.getMessage());
        } catch (RuntimeException releaseFailure) {
            // The hold carries an expiry, so the money is not lost; it is only late.
            // Failing the payment anyway keeps the service honest about the outcome.
            log.error("payment {}: releasing hold {} failed ({}); the account service will expire it",
                    payment.getPaymentNumber(), hold.holdId(), releaseFailure.getMessage());
        }

        failPayment(paymentId, failure);
        throw failure;
    }

    private void failPayment(String paymentId, DomainException reason) {
        try {
            state.markFailed(paymentId, reason.errorCode(), reason.getMessage());
        } catch (RuntimeException alreadyResolved) {
            // Masking the original failure with "already settled" would hide the real
            // cause from the caller and from the logs.
            log.warn("payment {} could not be marked as failed: {}", paymentId, alreadyResolved.getMessage());
        }
    }

    // ------------------------------------------------------------------ helpers

    private String resolveTarget(PaymentDtos.TransferRequest request) {
        if (request.targetAccountId() != null && !request.targetAccountId().isBlank()) {
            return request.targetAccountId();
        }
        if (request.targetPhone() == null || request.targetPhone().isBlank()) {
            throw DomainException.of(PaymentErrorCode.TARGET_ACCOUNT_NOT_FOUND,
                    "either targetPhone or targetAccountId is required to address the recipient");
        }
        return accounts.resolveByPhone(request.targetPhone(), request.currency()).accountId();
    }

    private void requireCallerMayUse(AuthenticatedUser caller, AccountServiceClient.AccountSnapshot source) {
        // The public endpoint already refused anyone else; this is the second lock on
        // the same door, and the one that decides which error code the client sees.
        if (caller == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!caller.canAccess(source.ownerUserId())) {
            throw DomainException.of(PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED,
                            "account {} belongs to another user", source.accountId())
                    .withDetail("accountId", source.accountId());
        }
    }

    private static void requireCurrency(String accountCurrency, Currency requested, String what) {
        if (accountCurrency == null || !accountCurrency.equalsIgnoreCase(requested.name())) {
            throw DomainException.of(PaymentErrorCode.INVALID_AMOUNT,
                    "{} is in {} but the payment is in {}", what, accountCurrency, requested);
        }
    }

    private static void requirePositiveAmount(long amountMinor) {
        if (amountMinor <= 0) {
            throw DomainException.of(PaymentErrorCode.INVALID_AMOUNT,
                    "amount must be positive but was {}", amountMinor);
        }
    }

    private static String describe(String description, String fallback) {
        if (description == null || description.isBlank()) {
            return fallback;
        }
        return description.length() <= MAX_REASON_LENGTH ? description : description.substring(0, MAX_REASON_LENGTH);
    }

    /**
     * True when a downstream failure says nothing about whether the money moved:
     * "the call did not come back" is not "the credit did not happen".
     */
    private static boolean isAmbiguous(DomainException failure) {
        return failure.errorCode() == PaymentErrorCode.DOWNSTREAM_UNAVAILABLE
                || failure.errorCode() == PaymentErrorCode.ACCOUNT_SERVICE_ERROR;
    }

    private DomainException asDomainException(RuntimeException failure, String what) {
        if (failure instanceof DomainException domain) {
            return domain;
        }
        log.error("unexpected failure while trying to {}", what, failure);
        return DomainException.of(PaymentErrorCode.HOLD_FAILED, "could not {}: {}", what, failure.getMessage());
    }

    private String requestHash(Object request) {
        try {
            return RequestHash.of(objectMapper.writeValueAsString(request)).value();
        } catch (Exception serializationFailure) {
            throw new IllegalStateException("the request body cannot be hashed for idempotency", serializationFailure);
        }
    }
}
