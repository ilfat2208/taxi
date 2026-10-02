package kz.taxi.payment.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentSagaMarker;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.PaymentType;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.domain.RefundStatus;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.PaymentProperties;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * Resolves payments (and refunds) that nobody is driving any more.
 *
 * <p>A payment that is stuck is not necessarily a failed payment: the process that
 * was moving the money may have been killed between the hold and the capture, and
 * its fate can only be read from the account service. This job exists so that the
 * end state never depends on whether a JVM survived.
 *
 * <h2>The rule, in full</h2>
 * <p>Everything is decided from two facts: the saga marker written before each
 * remote call and the status of the hold the account service reports.
 * <table>
 *   <tr><th>status</th><th>saga marker</th><th>hold</th><th>decision</th></tr>
 *   <tr><td>INITIATED</td><td>any</td><td>not asked</td>
 *       <td>fail: the PENDING marker is committed <em>before</em> the hold request, so
 *           an INITIATED payment never reserved any money</td></tr>
 *   <tr><td>PENDING</td><td>HOLDING without a hold id</td><td>ACTIVE</td>
 *       <td>capture and complete: the reservation is the proof that the caller's
 *           request was accepted</td></tr>
 *   <tr><td>PENDING</td><td>HOLDING without a hold id</td><td>none</td>
 *       <td>fail: no reservation was ever confirmed, and a hold is never created by
 *           the recovery job — that would move money nobody asked for</td></tr>
 *   <tr><td>PENDING</td><td>CAPTURING</td><td>CAPTURED</td>
 *       <td>complete: the capture landed, only the local commit was lost</td></tr>
 *   <tr><td>PENDING</td><td>CAPTURING</td><td>ACTIVE</td>
 *       <td>capture (again) and complete: the capture was requested and never landed,
 *           and re-capturing is idempotent on the account side</td></tr>
 *   <tr><td>PENDING</td><td>CAPTURING</td><td>RELEASED/EXPIRED</td>
 *       <td>fail: the money went back (or was never taken), so completing would
 *           invent a movement</td></tr>
 *   <tr><td>PENDING</td><td>RELEASING</td><td>CAPTURED</td>
 *       <td>complete: the compensation was based on a failure that turned out to be a
 *           lie (typically a timeout) while the money actually moved</td></tr>
 *   <tr><td>PENDING</td><td>RELEASING</td><td>anything else</td>
 *       <td>release and fail: finish the compensation the saga had already chosen</td></tr>
 *   <tr><td>PENDING</td><td>unreadable</td><td>not asked</td>
 *       <td>fail: a payment whose step cannot be read is closed rather than guessed
 *           at (it was not written by this version of the service)</td></tr>
 *   <tr><td>INITIATED/PENDING</td><td>any</td><td>any</td>
 *       <td>after {@code max-attempts}: release best effort, then fail — the bound
 *           that stops a payment from being retried forever while the account
 *           service is down</td></tr>
 * </table>
 *
 * <p>An attempt is recorded as a {@code payment_transition} row with actor
 * {@code recovery}, which is both the audit trail and the counter behind
 * {@code max-attempts}.
 *
 * <p>The job is safe to run from several replicas at once: each payment is claimed
 * under a pessimistic row lock, and every remote call it makes is idempotent
 * (a replayed hold, a replayed capture, a replayed credit), so the worst a race
 * produces is a duplicate attempt, never a double movement.
 */
@Service
@Slf4j
public class PaymentRecoveryService {

    private static final List<PaymentStatus> STUCK_STATUSES = List.of(PaymentStatus.INITIATED, PaymentStatus.PENDING);

    private final AccountServiceClient accounts;
    private final PaymentStateService state;
    private final PaymentRepository payments;
    private final RefundRepository refunds;
    private final PaymentProperties properties;

    public PaymentRecoveryService(AccountServiceClient accounts,
                                  PaymentStateService state,
                                  PaymentRepository payments,
                                  RefundRepository refunds,
                                  PaymentProperties properties) {
        this.accounts = accounts;
        this.state = state;
        this.payments = payments;
        this.refunds = refunds;
        this.properties = properties;
    }

    /**
     * Resolves one batch of stuck payments.
     *
     * @return how many payments reached a terminal state in this round
     */
    public int recoverStuckPayments(int batchSize) {
        Instant threshold = Instant.now().minus(properties.stuckThreshold());
        List<Payment> stuck = payments.findStuck(STUCK_STATUSES, threshold, PageRequest.of(0, Math.max(batchSize, 1)));
        if (stuck.isEmpty()) {
            return 0;
        }
        log.info("recovery: {} payment(s) stuck for longer than {}", stuck.size(), properties.stuckThreshold());
        int resolved = 0;
        for (Payment candidate : stuck) {
            try {
                if (recover(candidate.getId())) {
                    resolved++;
                }
            } catch (RuntimeException failure) {
                // A single unresolvable payment (or a transient account-service outage)
                // must not stop the batch: the next round picks it up again.
                log.warn("recovery of payment {} failed and will be retried: {}",
                        candidate.getId(), failure.getMessage());
            }
        }
        return resolved;
    }

    /**
     * Resumes refunds whose credit never reported back.
     *
     * <p>Retrying is free: the credit is idempotent by {@code (REFUND, refundId)}.
     * A refund is only left {@code INITIATED} — never failed — when the account
     * service could not be reached, because "we do not know" and "the money did not
     * move" are different facts, and marking it failed would let a fresh refund of
     * the same money be created.
     *
     * @return how many refunds were completed in this round
     */
    public int recoverStuckRefunds(int batchSize) {
        Instant threshold = Instant.now().minus(properties.stuckThreshold());
        List<Refund> stale = refunds.findByStatusAndCreatedAtBeforeOrderByCreatedAtAsc(
                RefundStatus.INITIATED, threshold, PageRequest.of(0, Math.max(batchSize, 1)));
        int resolved = 0;
        for (Refund refund : stale) {
            try {
                if (resumeRefund(refund)) {
                    resolved++;
                }
            } catch (RuntimeException failure) {
                log.warn("recovery of refund {} failed and will be retried: {}", refund.getId(), failure.getMessage());
            }
        }
        return resolved;
    }

    // ------------------------------------------------------------------ internals

    private boolean resumeRefund(Refund refund) {
        Payment payment = payments.findById(refund.getPaymentId()).orElse(null);
        if (payment == null) {
            log.error("refund {} references missing payment {}", refund.getId(), refund.getPaymentId());
            return false;
        }
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
            log.warn("recovery could not credit refund {} of payment {}: {}",
                    refund.getId(), payment.getPaymentNumber(), creditFailure.getMessage());
            return false;
        }
        state.completeRefund(refund.getId());
        log.info("recovery completed refund {} of payment {}", refund.getId(), payment.getPaymentNumber());
        return true;
    }

    /** One recovery round for one payment. Package-visible so it can be unit-tested without the scheduler. */
    boolean recover(String paymentId) {
        Optional<PaymentStateService.RecoveryAttempt> claimed =
                state.beginRecoveryAttempt(paymentId, properties.getSaga().getMaxAttempts());
        if (claimed.isEmpty()) {
            return false;
        }
        PaymentStateService.RecoveryAttempt attempt = claimed.get();
        Payment payment = attempt.payment();

        if (attempt.exhausted()) {
            log.warn("recovery: payment {} is still unresolved after {} attempts, failing it",
                    payment.getPaymentNumber(), attempt.attempt());
            return fail(payment, "recovery: gave up after " + attempt.attempt() + " attempts,"
                    + " the account service never produced a resolvable state");
        }

        if (payment.getStatus() == PaymentStatus.INITIATED) {
            return fail(payment, "recovery: the saga stopped before it reserved any funds");
        }

        PaymentSagaMarker marker = payment.sagaMarker();
        if (marker == null) {
            return fail(payment, "recovery: the payment carries no readable saga step");
        }

        if (marker.step() == PaymentSagaMarker.Step.HOLDING && !marker.hasHoldId()) {
            // The hold request went out but its answer was never recorded: ask the
            // account service directly instead of assuming either outcome.
            Optional<AccountServiceClient.HoldSnapshot> active = accounts.findActiveHold(
                    AccountServiceClient.REFERENCE_TYPE_PAYMENT, paymentId, payment.getSourceAccountId());
            if (active.isEmpty()) {
                return fail(payment, "recovery: no hold was confirmed for this payment, nothing was reserved");
            }
            return captureAndComplete(payment, active.get().holdId());
        }

        Optional<AccountServiceClient.HoldSnapshot> found = accounts.findHold(marker.holdId());
        if (found.isEmpty()) {
            return fail(payment, "recovery: hold " + marker.holdId() + " no longer exists, no money moved");
        }
        AccountServiceClient.HoldSnapshot hold = found.get();
        return switch (hold.state()) {
            case CAPTURED -> complete(payment, "the capture had already moved the money");
            case ACTIVE -> marker.isCompensating()
                    ? fail(payment, "recovery: the saga had already decided to release the funds")
                    : captureAndComplete(payment, hold.holdId());
            case RELEASED, EXPIRED -> fail(payment, "recovery: hold " + hold.holdId() + " is " + hold.status()
                    + ", so no money moves with this payment");
            case UNKNOWN -> fail(payment, "recovery: hold " + hold.holdId() + " has an unreadable status "
                    + hold.status());
        };
    }

    private boolean captureAndComplete(Payment payment, String holdId) {
        String operation = payment.getType().ledgerOperation();
        String targetAccountId = payment.hasTargetAccount() ? payment.getTargetAccountId() : null;

        try {
            state.beginCapture(payment.getId(), holdId);
        } catch (RuntimeException cannotMark) {
            log.debug("recovery: could not record the capture intent for payment {}: {}",
                    payment.getId(), cannotMark.getMessage());
        }

        AccountServiceClient.CaptureResult capture;
        try {
            capture = accounts.capture(holdId, new AccountServiceClient.CaptureRequest(
                    targetAccountId,
                    AccountServiceClient.REFERENCE_TYPE_PAYMENT,
                    payment.getId(),
                    operation,
                    "recovery of payment " + payment.getPaymentNumber()));
        } catch (DomainException captureRefused) {
            log.warn("recovery: capture of hold {} for payment {} was refused with {}: {}",
                    holdId, payment.getPaymentNumber(), captureRefused.errorCode().code(), captureRefused.getMessage());
            return fail(payment, "recovery: capture refused with " + captureRefused.errorCode().code());
        }

        state.markCompleted(payment.getId());
        log.info("recovery completed payment {} as transaction {}",
                payment.getPaymentNumber(), capture.transactionId());
        return true;
    }

    private boolean complete(Payment payment, String reason) {
        state.markCompleted(payment.getId());
        log.info("recovery completed payment {}: {}", payment.getPaymentNumber(), reason);
        return true;
    }

    /** Ends a payment that cannot move money: give the reservation back, then fail it. */
    private boolean fail(Payment payment, String reason) {
        releaseBestEffort(payment);
        state.markFailed(payment.getId(), PaymentErrorCode.HOLD_FAILED, reason);
        log.info("recovery failed payment {}: {}", payment.getPaymentNumber(), reason);
        return true;
    }

    /**
     * Releases the payment's hold if it is still active.
     *
     * <p>Best effort on purpose: if the account service is unreachable, the hold
     * carries an expiry and the account service will return the funds itself, and
     * failing the payment anyway is better than leaving it open forever.
     */
    private void releaseBestEffort(Payment payment) {
        PaymentSagaMarker marker = payment.sagaMarker();
        if (marker == null || !marker.hasHoldId()) {
            return;
        }
        try {
            accounts.findHold(marker.holdId())
                    .filter(hold -> hold.state() == AccountServiceClient.HoldState.ACTIVE)
                    .ifPresent(hold -> accounts.release(hold.holdId(),
                            "payment " + payment.getPaymentNumber() + " resolved as failed by the recovery job"));
        } catch (RuntimeException releaseFailure) {
            log.warn("recovery could not release hold {} of payment {}: {}",
                    marker.holdId(), payment.getPaymentNumber(), releaseFailure.getMessage());
        }
    }
}
