package kz.taxi.payment.application;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.error.ErrorCode;
import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentFees;
import kz.taxi.payment.domain.PaymentIntent;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.PaymentTransition;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.PaymentTransitionRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import lombok.extern.slf4j.Slf4j;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.SQLException;
import java.util.Optional;

/**
 * Every durable step of the payment state machine, each in its own transaction.
 *
 * <p>This class is the seam that makes the saga restartable. The orchestrator in
 * {@link PaymentSagaService} never opens a transaction itself, so a remote call is
 * never made while a database transaction is open, and each step below commits
 * before the next HTTP request leaves the service. The ordering rule the whole
 * service rests on:
 *
 * <pre>
 *   write the step (transaction)  ->  make the remote call  ->  write the outcome (transaction)
 * </pre>
 *
 * <p>The state change and its event always commit together (outbox pattern), so an
 * event can be late but never phantom, and the state can be behind the account
 * service but is always recoverable from it.
 */
@Service
@Slf4j
public class PaymentStateService {

    /**
     * The unique index that makes "one payment per idempotency key" a fact of the
     * database rather than a promise of the service.
     */
    private static final String IDEMPOTENCY_KEY_CONSTRAINT = "uq_payment_idempotency_key";

    private final PaymentRepository payments;
    private final PaymentTransitionRepository transitions;
    private final RefundRepository refunds;
    private final OutboxWriter outbox;
    private final PaymentMetrics metrics;

    public PaymentStateService(PaymentRepository payments,
                               PaymentTransitionRepository transitions,
                               RefundRepository refunds,
                               OutboxWriter outbox,
                               PaymentMetrics metrics) {
        this.payments = payments;
        this.transitions = transitions;
        this.refunds = refunds;
        this.outbox = outbox;
        this.metrics = metrics;
    }

    /** What a caller of {@link #openRefund} needs to know: the row, and whether the money is already back. */
    public record RefundStart(Refund refund, boolean completed) {
    }

    /** A recovery round: the payment, how many attempts it has now seen, and whether it is out of attempts. */
    public record RecoveryAttempt(Payment payment, long attempt, boolean exhausted) {
    }

    // ------------------------------------------------------------------ creation

    /**
     * Creates the payment, its first transition and its {@code payment.initiated} event.
     *
     * <p>The client's idempotency key is stored here and protected by a unique
     * index: the Redis guard already replays retries, but two replicas can still
     * race, and the database is the only component that cannot be raced.
     *
     * <p>Only a violation of that index is reported as an idempotency conflict. Every
     * other integrity failure — a value that does not fit its column, a CHECK, a NOT
     * NULL, a foreign key — is a defect, and saying "this key already exists" about it
     * sends the caller and the operator looking in the wrong place: the caller reads
     * back the outcome of a payment that was never created (or retries forever), and
     * the real reason stays invisible. See {@link #isDuplicateIdempotencyKey}.
     */
    @Transactional
    public Payment initiate(PaymentIntent intent, PaymentFees.FeeBreakdown money) {
        Payment payment = Payment.initiate(intent, money);
        try {
            payments.saveAndFlush(payment);
        } catch (DataIntegrityViolationException violation) {
            if (isDuplicateIdempotencyKey(violation)) {
                // Someone already used this key. The code matters to the caller: it means
                // "do not retry blindly, look the outcome up by order/payment id" — which
                // is exactly what order-service does with IDEMPOTENCY_CONFLICT, and why
                // the internal read endpoints exist. A generic CONFLICT would look like a
                // different, unexplainable failure.
                throw DomainException.of(CommonErrorCode.IDEMPOTENCY_CONFLICT,
                                "a payment with idempotency key '{}' already exists; read its outcome instead of retrying",
                                intent.idempotencyKey())
                        .withDetail("idempotencyKey", intent.idempotencyKey());
            }
            String violated = describeViolation(violation);
            log.error("payment for idempotency key {} could not be stored: the insert violated {}",
                    intent.idempotencyKey(), violated, violation);
            throw DomainException.of(CommonErrorCode.INTERNAL_ERROR,
                            "the payment could not be stored: the insert violated {}", violated)
                    .withDetail("constraint", violated);
        }
        transitions.save(PaymentTransition.of(payment.getId(), null, PaymentStatus.INITIATED,
                "payment created", PaymentTransition.ACTOR_API));
        publish(KafkaTopics.Events.PAYMENT_INITIATED, payment);
        log.info("payment {} ({}) initiated for user {} from account {}",
                payment.getPaymentNumber(), payment.getType(), payment.getOwnerUserId(), payment.getSourceAccountId());
        return payment;
    }

    // ------------------------------------------------------------------ saga steps

    /** Before the hold request: the payment must be visible as PENDING if this process dies. */
    @Transactional
    public Payment markPending(String paymentId) {
        Payment payment = require(paymentId);
        if (payment.markPending()) {
            transitions.save(PaymentTransition.of(paymentId, PaymentStatus.INITIATED, PaymentStatus.PENDING,
                    "funds reservation requested", PaymentTransition.ACTOR_SAGA));
            log.debug("payment {} moved to PENDING", payment.getPaymentNumber());
        }
        return payment;
    }

    /** After the hold request: remembers which hold this payment owns. */
    @Transactional
    public Payment recordHold(String paymentId, String holdId) {
        Payment payment = require(paymentId);
        payment.recordHold(holdId);
        return payment;
    }

    /** Before the capture request: money may be about to move, and the hold id must survive a crash. */
    @Transactional
    public Payment beginCapture(String paymentId, String holdId) {
        Payment payment = require(paymentId);
        payment.beginCapture(holdId);
        return payment;
    }

    /** Before the release request: the intent to compensate is durable, not a local variable. */
    @Transactional
    public Payment beginRelease(String paymentId, String holdId, String reason) {
        Payment payment = require(paymentId);
        payment.beginRelease(holdId, reason);
        return payment;
    }

    // ------------------------------------------------------------------ outcomes

    /** Money moved. Transition and {@code payment.completed} commit together. */
    @Transactional
    public Payment markCompleted(String paymentId) {
        Payment payment = require(paymentId);
        PaymentStatus from = payment.getStatus();
        payment.markCompleted();
        transitions.save(PaymentTransition.of(paymentId, from, PaymentStatus.COMPLETED,
                "funds captured", PaymentTransition.ACTOR_SAGA));
        publish(KafkaTopics.Events.PAYMENT_COMPLETED, payment);
        metrics.paymentOutcome(payment.getType(), PaymentStatus.COMPLETED.name(), payment.getCurrency());
        log.info("payment {} completed", payment.getPaymentNumber());
        return payment;
    }

    /** The payment is closed. {@code false} from the entity means it was already failed. */
    @Transactional
    public Payment markFailed(String paymentId, ErrorCode errorCode, String reason) {
        Payment payment = require(paymentId);
        PaymentStatus from = payment.getStatus();
        if (payment.markFailed(errorCode, reason)) {
            transitions.save(PaymentTransition.of(paymentId, from, PaymentStatus.FAILED, reason,
                    PaymentTransition.ACTOR_SAGA));
            publish(KafkaTopics.Events.PAYMENT_FAILED, payment);
            // The reason tag is what makes the success-rate dashboard actionable:
            // "payments fail" is a fact, "they fail with INSUFFICIENT_FUNDS" is a decision.
            metrics.paymentOutcome(payment.getType(), PaymentStatus.FAILED.name(), payment.getCurrency());
            metrics.paymentFailed(payment.getFailureCode());
            log.info("payment {} failed with {}", payment.getPaymentNumber(), payment.getFailureCode());
        }
        return payment;
    }

    /** A completed payment was refunded in full: {@code COMPLETED -> REVERSED}. */
    @Transactional
    public Payment markReversed(String paymentId, String reason) {
        Payment payment = require(paymentId);
        payment.markReversed(reason);
        transitions.save(PaymentTransition.of(paymentId, PaymentStatus.COMPLETED, PaymentStatus.REVERSED,
                reason, PaymentTransition.ACTOR_REFUND));
        publish(KafkaTopics.Events.PAYMENT_REVERSED, payment);
        metrics.paymentOutcome(payment.getType(), PaymentStatus.REVERSED.name(), payment.getCurrency());
        log.info("payment {} reversed: {}", payment.getPaymentNumber(), reason);
        return payment;
    }

    // ------------------------------------------------------------------ refunds

    /**
     * Locks the payment and creates (or finds) the refund row.
     *
     * <p>The row is committed before the credit is attempted, and its id becomes the
     * business reference of that credit, which is what makes a retried refund safe:
     * the account service recognises {@code (REFUND, refundId)} and never pays twice.
     *
     * <p>The payment row is locked pessimistically because the cumulative limit is a
     * read-then-write: two concurrent partial refunds would each see only their own
     * amount and together overdraw the payment.
     */
    @Transactional
    public RefundStart openRefund(AuthenticatedUser caller,
                                  String paymentId,
                                  Long requestedAmountMinor,
                                  String reason,
                                  String idempotencyKey) {
        Payment payment = payments.findByIdForUpdate(paymentId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "payment {} not found", paymentId));
        PaymentAccess.require(caller, payment);

        Optional<Refund> existing = refunds.findByIdempotencyKey(idempotencyKey);
        if (existing.isPresent()) {
            log.debug("refund {} already exists for idempotency key {}, resuming", existing.get().getId(), idempotencyKey);
            return new RefundStart(existing.get(), existing.get().isCompleted());
        }

        if (payment.getStatus() == PaymentStatus.REVERSED) {
            throw DomainException.of(PaymentErrorCode.PAYMENT_NOT_REVERSIBLE,
                    "payment {} is already reversed in full", payment.getPaymentNumber());
        }
        if (payment.getStatus() != PaymentStatus.COMPLETED) {
            throw DomainException.of(PaymentErrorCode.PAYMENT_NOT_COMPLETED,
                            "payment {} is {} and cannot be refunded", payment.getPaymentNumber(), payment.getStatus())
                    .withDetail("status", payment.getStatus().name());
        }

        long alreadyRefunded = refunds.sumRefunded(paymentId);
        long refundable = payment.getAmountMinor() - alreadyRefunded;
        // A null amount means "whatever is still refundable", which is not the same as
        // "the whole payment": order-service cancels an order by sending exactly that null
        // (PaymentClient#refund), and on a payment that was already refunded in part the
        // difference is the difference between "refund the rest" and REFUND_EXCEEDS_PAYMENT
        // — a cancellation that can never succeed, however often it is retried.
        long amountMinor = requestedAmountMinor == null ? refundable : requestedAmountMinor;
        if (amountMinor <= 0) {
            throw DomainException.of(PaymentErrorCode.INVALID_AMOUNT,
                    "refund amount must be positive but was {}", amountMinor);
        }
        if (amountMinor > refundable) {
            throw DomainException.of(PaymentErrorCode.REFUND_EXCEEDS_PAYMENT,
                            "cannot refund {} of a payment of {} with {} already refunded",
                            amountMinor, payment.getAmountMinor(), alreadyRefunded)
                    .withDetail("paymentAmountMinor", payment.getAmountMinor())
                    .withDetail("alreadyRefundedMinor", alreadyRefunded)
                    .withDetail("requestedMinor", amountMinor);
        }

        Refund refund = refunds.save(Refund.initiate(paymentId, amountMinor, payment.getCurrency(), reason,
                idempotencyKey));
        log.info("refund {} of {} minor units created for payment {}", refund.getId(), amountMinor,
                payment.getPaymentNumber());
        return new RefundStart(refund, false);
    }

    /**
     * The credit landed: marks the refund completed, and reverses the payment when
     * nothing of it is left to refund.
     */
    @Transactional
    public Refund completeRefund(String refundId) {
        Refund refund = refunds.findById(refundId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "refund {} not found", refundId));
        if (refund.isCompleted()) {
            return refund;
        }
        refund.complete();
        refunds.save(refund);

        long refunded = refunds.sumRefunded(refund.getPaymentId());
        Payment payment = payments.findByIdForUpdate(refund.getPaymentId())
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "payment {} not found", refund.getPaymentId()));
        if (payment.getStatus() == PaymentStatus.COMPLETED && refunded >= payment.getAmountMinor()) {
            payment.markReversed("refunded in full: " + refunded + " of " + payment.getAmountMinor() + " minor units");
            transitions.save(PaymentTransition.of(payment.getId(), PaymentStatus.COMPLETED, PaymentStatus.REVERSED,
                    "refunded in full", PaymentTransition.ACTOR_REFUND));
            publish(KafkaTopics.Events.PAYMENT_REVERSED, payment);
            log.info("payment {} reversed after a full refund", payment.getPaymentNumber());
        }
        return refund;
    }

    /** The credit was rejected: the refund moved no money and stops counting towards the limit. */
    @Transactional
    public Refund failRefund(String refundId, String reason) {
        Refund refund = refunds.findById(refundId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "refund {} not found", refundId));
        refund.fail(reason);
        return refunds.save(refund);
    }

    // ------------------------------------------------------------------ recovery

    /**
     * Claims a stuck payment for one recovery round.
     *
     * <p>The row lock keeps two replicas from working on the same payment at the
     * same time, and the {@code recovery} transition row is both the audit entry and
     * the attempt counter — a payment that cannot be resolved is eventually failed
     * instead of retried forever.
     */
    @Transactional
    public Optional<RecoveryAttempt> beginRecoveryAttempt(String paymentId, int maxAttempts) {
        Payment payment = payments.findByIdForUpdate(paymentId).orElse(null);
        if (payment == null || payment.getStatus().isTerminal()) {
            return Optional.empty();
        }
        long attempt = transitions.countByPaymentIdAndActor(paymentId, PaymentTransition.ACTOR_RECOVERY) + 1;
        transitions.save(PaymentTransition.of(paymentId, payment.getStatus(), payment.getStatus(),
                "recovery attempt " + attempt + " (status=" + payment.getStatus()
                        + ", saga=" + payment.getSagaState() + ")", PaymentTransition.ACTOR_RECOVERY));
        return Optional.of(new RecoveryAttempt(payment, attempt, attempt > maxAttempts));
    }

    // ------------------------------------------------------------------ internals

    /**
     * True when the database refused the insert because this idempotency key is already
     * taken — and only then.
     *
     * <p>The decision is made on the constraint that was violated, never on the exception
     * type: Spring reports <em>every</em> integrity failure as a
     * {@code DataIntegrityViolationException}, so the type alone says nothing about which
     * rule was broken. Hibernate fills the constraint name in from the server error, and
     * when it does not (an older driver, a driver that does not report the field), the
     * name is still in the message the same failure carries.
     */
    private static boolean isDuplicateIdempotencyKey(DataIntegrityViolationException violation) {
        for (Throwable cause = violation; cause != null && cause != cause.getCause(); cause = cause.getCause()) {
            if (cause instanceof ConstraintViolationException constraint
                    && IDEMPOTENCY_KEY_CONSTRAINT.equals(constraint.getConstraintName())) {
                return true;
            }
            if (cause.getMessage() != null && cause.getMessage().contains(IDEMPOTENCY_KEY_CONSTRAINT)) {
                return true;
            }
        }
        return false;
    }

    /**
     * What the database actually complained about, in the form that is safe to hand back:
     * the constraint and the SQL state.
     *
     * <p>Deliberately not the driver's message: a CHECK or NOT NULL violation on PostgreSQL
     * reads {@code Failing row contains (...)} and lists the column values, which is payment
     * data. The full exception — that row included — goes to the log, where the on-call
     * engineer needs it and no client can see it.
     */
    private static String describeViolation(DataIntegrityViolationException violation) {
        String constraint = null;
        String sqlState = "unknown";
        for (Throwable cause = violation; cause != null && cause != cause.getCause(); cause = cause.getCause()) {
            if (constraint == null && cause instanceof ConstraintViolationException named) {
                constraint = named.getConstraintName();
            }
            if ("unknown".equals(sqlState) && cause instanceof SQLException sql && sql.getSQLState() != null) {
                sqlState = sql.getSQLState();
            }
        }
        return constraint == null
                ? "a database constraint (SQLState " + sqlState + ")"
                : "constraint " + constraint + " (SQLState " + sqlState + ")";
    }

    private Payment require(String paymentId) {
        return payments.findById(paymentId)
                .orElseThrow(() -> DomainException.of(PaymentErrorCode.PAYMENT_NOT_FOUND,
                        "payment {} not found", paymentId));
    }

    /**
     * Writes the event into the outbox inside the caller's transaction: the state
     * change and the fact that announces it are committed or rolled back together.
     */
    private void publish(String eventType, Payment payment) {
        outbox.append(KafkaTopics.PAYMENT_EVENTS, EventEnvelope.of(eventType, "Payment", payment.getId(),
                payment.getVersion(), PaymentEvents.PaymentEvent.of(payment)));
    }
}
