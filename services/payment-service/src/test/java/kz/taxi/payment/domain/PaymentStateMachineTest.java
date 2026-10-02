package kz.taxi.payment.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.support.TestPayments;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The state machine, from both sides: the moves that are legal and the ones that
 * must be refused.
 *
 * <p>What is really being tested is that a payment can never reach a state that
 * claims something untrue — money moved that did not, or a payment that is closed
 * moving again.
 */
class PaymentStateMachineTest {

    @Test
    @DisplayName("a new payment starts INITIATED with no saga step and a readable number")
    void new_payment_starts_initiated() {
        Payment payment = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);

        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.INITIATED);
        assertThat(payment.getSagaState()).isNull();
        assertThat(payment.sagaMarker()).isNull();
        assertThat(payment.getCompletedAt()).isNull();
        assertThat(PaymentNumber.isValid(payment.getPaymentNumber())).isTrue();
        assertThat(payment.getPaymentNumber()).startsWith("P").hasSize(27);
        assertThat(payment.getTotalMinor()).isEqualTo(payment.getAmountMinor() + payment.getFeeMinor());
    }

    @Test
    @DisplayName("INITIATED -> PENDING -> COMPLETED is legal and records the saga steps")
    void legal_path_to_completed() {
        Payment payment = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);

        assertThat(payment.markPending()).isTrue();
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.PENDING);
        assertThat(payment.getSagaState()).isEqualTo("HOLD");

        payment.recordHold(TestPayments.HOLD_ID);
        assertThat(payment.getSagaState()).isEqualTo("HOLD#" + TestPayments.HOLD_ID);

        payment.beginCapture(TestPayments.HOLD_ID);
        assertThat(payment.getSagaState()).isEqualTo("CAP#" + TestPayments.HOLD_ID);
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.PENDING);

        payment.markCompleted();

        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.COMPLETED);
        assertThat(payment.getCompletedAt()).isNotNull();
        assertThat(payment.getSagaState()).isNull();
    }

    @Test
    @DisplayName("markPending is idempotent: a retried saga step is not a second reservation")
    void mark_pending_twice_changes_nothing() {
        Payment payment = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));

        assertThat(payment.markPending()).isFalse();
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.PENDING);
    }

    @Test
    @DisplayName("a payment can fail from INITIATED or PENDING, and failing twice is a no-op")
    void failure_is_legal_before_completion() {
        Payment fromInitiated = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);
        assertThat(fromInitiated.markFailed(PaymentErrorCode.INSUFFICIENT_FUNDS, "no money")).isTrue();
        assertThat(fromInitiated.getStatus()).isEqualTo(PaymentStatus.FAILED);
        assertThat(fromInitiated.getFailureCode()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(fromInitiated.getFailureReason()).isEqualTo("no money");
        assertThat(fromInitiated.getSagaState()).isNull();

        Payment fromPending = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        assertThat(fromPending.markFailed(PaymentErrorCode.HOLD_FAILED, "capture failed")).isTrue();
        assertThat(fromPending.markFailed(PaymentErrorCode.HOLD_FAILED, "capture failed again")).isFalse();
        assertThat(fromPending.getStatus()).isEqualTo(PaymentStatus.FAILED);
    }

    @Test
    @DisplayName("a completed payment can be reversed, and that is the only thing it can do")
    void completed_can_only_be_reversed() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));

        payment.markReversed("refunded in full");

        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.REVERSED);
        assertThat(payment.getFailureReason()).isEqualTo("refunded in full");
        assertThat(payment.getSagaState()).isNull();
    }

    // ------------------------------------------------------------------ illegal moves

    @Test
    @DisplayName("a payment cannot complete before it reserved funds")
    void cannot_complete_from_initiated() {
        Payment payment = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);

        assertThatThrownBy(payment::markCompleted)
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_COMPLETED);

        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.INITIATED);
    }

    @Test
    @DisplayName("a payment cannot complete twice: the money moved once")
    void cannot_complete_twice() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));

        assertThatThrownBy(payment::markCompleted)
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_ALREADY_COMPLETED);
    }

    @Test
    @DisplayName("a payment cannot fail once it completed: it fails only through a refund")
    void completed_cannot_fail() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));

        assertThatThrownBy(() -> payment.markFailed(PaymentErrorCode.HOLD_FAILED, "too late"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_ALREADY_COMPLETED);
    }

    @Test
    @DisplayName("only a completed payment can be reversed")
    void only_completed_can_be_reversed() {
        Payment pending = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        assertThatThrownBy(() -> pending.markReversed("nope"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_REVERSIBLE);

        Payment failed = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);
        failed.markFailed(PaymentErrorCode.HOLD_FAILED, "no");
        assertThatThrownBy(() -> failed.markReversed("nope"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_REVERSIBLE);
    }

    @Test
    @DisplayName("a closed payment cannot go back to PENDING or open a saga step")
    void terminal_states_are_final() {
        Payment completed = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));

        assertThatThrownBy(completed::markPending)
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.HOLD_FAILED);

        Payment initiated = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);
        assertThatThrownBy(() -> initiated.beginCapture(TestPayments.HOLD_ID))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.HOLD_FAILED);
    }

    @Test
    @DisplayName("the allowed edges are exactly the ones the schema and the saga rely on")
    void transition_table_is_explicit() {
        assertThat(PaymentStatus.INITIATED.canTransitionTo(PaymentStatus.PENDING)).isTrue();
        assertThat(PaymentStatus.INITIATED.canTransitionTo(PaymentStatus.FAILED)).isTrue();
        assertThat(PaymentStatus.INITIATED.canTransitionTo(PaymentStatus.COMPLETED)).isFalse();
        assertThat(PaymentStatus.PENDING.canTransitionTo(PaymentStatus.COMPLETED)).isTrue();
        assertThat(PaymentStatus.PENDING.canTransitionTo(PaymentStatus.FAILED)).isTrue();
        assertThat(PaymentStatus.PENDING.canTransitionTo(PaymentStatus.REVERSED)).isFalse();
        assertThat(PaymentStatus.COMPLETED.canTransitionTo(PaymentStatus.REVERSED)).isTrue();
        assertThat(PaymentStatus.COMPLETED.canTransitionTo(PaymentStatus.FAILED)).isFalse();
        assertThat(PaymentStatus.FAILED.isTerminal()).isTrue();
        assertThat(PaymentStatus.REVERSED.isTerminal()).isTrue();
        assertThat(PaymentStatus.COMPLETED.isSettled()).isTrue();
        assertThat(PaymentStatus.FAILED.isSettled()).isFalse();
    }

    @Test
    @DisplayName("a merchant payment keeps the order it settles, a transfer keeps its recipient")
    void payment_keeps_what_it_is_about() {
        Payment merchant = TestPayments.merchant("U-1", "A-1", "O-1", 100_000, 1_500);

        assertThat(merchant.getOrderId()).isEqualTo("O-1");
        assertThat(merchant.getMerchantId()).isEqualTo("MERCHANT-1");
        assertThat(merchant.hasTargetAccount()).isFalse();
        assertThat(merchant.getFeeMinor()).isEqualTo(1_500);
        assertThat(merchant.getTotalMinor()).isEqualTo(101_500);

        Payment transfer = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);
        assertThat(transfer.hasTargetAccount()).isTrue();
        assertThat(transfer.getFeeMinor()).isZero();
        assertThat(transfer.isOwnedBy("U-1")).isTrue();
        assertThat(transfer.isOwnedBy("U-2")).isFalse();
    }
}
