package kz.taxi.payment.application;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.event.EventEnvelope;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentIntent;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.PaymentTransition;
import kz.taxi.payment.domain.PaymentType;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.PaymentTransitionRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import kz.taxi.payment.support.TestPayments;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;

import java.sql.SQLException;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The durable steps: what is written, and what is written <em>together</em>.
 *
 * <p>The outbox only works if the state change and its event are committed by the
 * same method call in the same transaction — an event written a moment later is an
 * event that can be lost. That is what these tests assert, together with the refund
 * limit, which is the one place where a read-then-write decides how much money
 * leaves the platform.
 */
class PaymentStateServiceTest {

    private PaymentRepository payments;
    private PaymentTransitionRepository transitions;
    private RefundRepository refunds;
    private OutboxWriter outbox;
    private PaymentStateService service;

    @BeforeEach
    void setUp() {
        payments = mock(PaymentRepository.class);
        transitions = mock(PaymentTransitionRepository.class);
        refunds = mock(RefundRepository.class);
        outbox = mock(OutboxWriter.class);
        service = new PaymentStateService(payments, transitions, refunds, outbox, mock(PaymentMetrics.class));
    }

    private void stubSaves() {
        when(payments.saveAndFlush(any(Payment.class))).thenAnswer(call -> call.getArgument(0));
        when(payments.findByIdForUpdate(anyString())).thenAnswer(call ->
                payments.findById(call.getArgument(0)));
        when(transitions.save(any(PaymentTransition.class))).thenAnswer(call -> call.getArgument(0));
        when(refunds.save(any(Refund.class))).thenAnswer(call -> call.getArgument(0));
    }

    // ------------------------------------------------------------------ creation

    @Test
    @DisplayName("creating a payment writes its first transition and payment.initiated in the same call")
    void initiate_writes_state_and_event_together() {
        stubSaves();
        PaymentIntent intent = TestPayments.intent(PaymentType.P2P_TRANSFER, "U-1", "A-1", "A-2",
                null, null, "key-1");

        Payment payment = service.initiate(intent, TestPayments.breakdown(100_000, 0));

        ArgumentCaptor<PaymentTransition> transition = ArgumentCaptor.forClass(PaymentTransition.class);
        verify(transitions).save(transition.capture());
        assertThat(transition.getValue().getPaymentId()).isEqualTo(payment.getId());
        assertThat(transition.getValue().getFromStatus()).isNull();
        assertThat(transition.getValue().getToStatus()).isEqualTo(PaymentStatus.INITIATED);
        assertThat(transition.getValue().getActor()).isEqualTo(PaymentTransition.ACTOR_API);

        ArgumentCaptor<EventEnvelope> envelope = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(outbox).append(eq(KafkaTopics.PAYMENT_EVENTS), envelope.capture());
        assertThat(envelope.getValue().eventType()).isEqualTo(KafkaTopics.Events.PAYMENT_INITIATED);
        assertThat(envelope.getValue().aggregateType()).isEqualTo("Payment");
        assertThat(envelope.getValue().aggregateId()).isEqualTo(payment.getId());
        assertThat(payload(envelope).status()).isEqualTo(PaymentStatus.INITIATED.name());
        assertThat(payload(envelope).paymentNumber()).isEqualTo(payment.getPaymentNumber());
    }

    @Test
    @DisplayName("a duplicate idempotency key is reported so the caller can look the outcome up, never as a 500")
    void duplicate_key_is_reported_as_a_conflict() {
        when(payments.saveAndFlush(any(Payment.class)))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("uq_payment_idempotency_key"));
        PaymentIntent intent = TestPayments.intent(PaymentType.P2P_TRANSFER, "U-1", "A-1", "A-2",
                null, null, "key-1");

        assertThatThrownBy(() -> service.initiate(intent, TestPayments.breakdown(100_000, 0)))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.IDEMPOTENCY_CONFLICT);

        verify(transitions, never()).save(any());
        verify(outbox, never()).append(anyString(), any(EventEnvelope.class));
    }

    @Test
    @DisplayName("a duplicate key the database reports by constraint name is still a conflict")
    void duplicate_key_is_recognised_from_the_constraint_name() {
        // What a driver that does not put the constraint into the message produces: the
        // decision has to come from the exception API, not from string matching alone.
        when(payments.saveAndFlush(any(Payment.class)))
                .thenThrow(constraintViolation("uq_payment_idempotency_key",
                        "ERROR: duplicate key value violates unique constraint", "23505"));
        PaymentIntent intent = TestPayments.intent(PaymentType.P2P_TRANSFER, "U-1", "A-1", "A-2",
                null, null, "key-1");

        assertThatThrownBy(() -> service.initiate(intent, TestPayments.breakdown(100_000, 0)))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.IDEMPOTENCY_CONFLICT);
    }

    @Test
    @DisplayName("a value that does not fit its column is not dressed up as an idempotency conflict")
    void other_integrity_failures_are_not_reported_as_an_idempotency_conflict() {
        // The failure this guards against, verbatim from the integration test that found
        // it: a merchant payment whose order id was 28 characters long went into a
        // VARCHAR(26) column, PostgreSQL answered SQLState 22001, and the caller was told
        // "a payment with idempotency key ... already exists; read its outcome instead of
        // retrying" — about a payment that was never created, with a retry instruction
        // that cannot help. The message has to name the real cause.
        when(payments.saveAndFlush(any(Payment.class)))
                .thenThrow(constraintViolation(null, "ERROR: value too long for type character varying(26)", "22001"));
        PaymentIntent intent = TestPayments.intent(PaymentType.MERCHANT_PAYMENT, "U-1", "A-1", null,
                "M-1", "01J8ZCQ7Y4R3F0N5G8K2M9QWA1X", "key-1");

        DomainException failure = catchThrowableOfType(
                () -> service.initiate(intent, TestPayments.breakdown(100_000, 1_500)), DomainException.class);

        assertThat(failure.errorCode()).isEqualTo(CommonErrorCode.INTERNAL_ERROR);
        assertThat(failure.getMessage())
                .as("the reason, not a story about an idempotency key")
                .contains("22001")
                .doesNotContain("already exists");
        assertThat(failure.details()).containsEntry("constraint", "a database constraint (SQLState 22001)");
        verify(transitions, never()).save(any());
        verify(outbox, never()).append(anyString(), any(EventEnvelope.class));
    }

    @Test
    @DisplayName("a duplicate of another unique constraint is not an idempotency conflict either")
    void duplicate_payment_number_is_not_reported_as_an_idempotency_conflict() {
        // The idempotency key is not the only unique index on the table: matching on
        // "some unique violation happened" would report a payment-number collision as
        // "this key already exists" and hide it just as effectively.
        when(payments.saveAndFlush(any(Payment.class)))
                .thenThrow(constraintViolation("uq_payment_number",
                        "ERROR: duplicate key value violates unique constraint \"uq_payment_number\"", "23505"));
        PaymentIntent intent = TestPayments.intent(PaymentType.P2P_TRANSFER, "U-1", "A-1", "A-2",
                null, null, "key-1");

        DomainException failure = catchThrowableOfType(
                () -> service.initiate(intent, TestPayments.breakdown(100_000, 0)), DomainException.class);

        assertThat(failure.errorCode()).isEqualTo(CommonErrorCode.INTERNAL_ERROR);
        assertThat(failure.getMessage()).contains("uq_payment_number");
    }

    /** The exception chain Spring hands to {@code initiate} for a PostgreSQL constraint error. */
    private static DataIntegrityViolationException constraintViolation(String constraintName,
                                                                      String driverMessage,
                                                                      String sqlState) {
        SQLException driver = new SQLException(driverMessage, sqlState);
        return new DataIntegrityViolationException(driverMessage,
                new org.hibernate.exception.ConstraintViolationException("could not execute statement",
                        driver, constraintName));
    }

    // ------------------------------------------------------------------ outcomes

    @Test
    @DisplayName("completing a payment writes PENDING -> COMPLETED and payment.completed in one call")
    void mark_completed_writes_transition_and_event_together() {
        stubSaves();
        Payment payment = TestPayments.capturing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000),
                TestPayments.HOLD_ID);
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        Payment completed = service.markCompleted(payment.getId());

        assertThat(completed.getStatus()).isEqualTo(PaymentStatus.COMPLETED);

        ArgumentCaptor<PaymentTransition> transition = ArgumentCaptor.forClass(PaymentTransition.class);
        verify(transitions).save(transition.capture());
        assertThat(transition.getValue().getFromStatus()).isEqualTo(PaymentStatus.PENDING);
        assertThat(transition.getValue().getToStatus()).isEqualTo(PaymentStatus.COMPLETED);

        ArgumentCaptor<EventEnvelope> envelope = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(outbox).append(eq(KafkaTopics.PAYMENT_EVENTS), envelope.capture());
        assertThat(envelope.getValue().eventType()).isEqualTo(KafkaTopics.Events.PAYMENT_COMPLETED);
        assertThat(envelope.getValue().aggregateVersion()).isEqualTo(completed.getVersion());
        assertThat(payload(envelope).status()).isEqualTo(PaymentStatus.COMPLETED.name());
    }

    @Test
    @DisplayName("failing a payment keeps the reason and publishes payment.failed")
    void mark_failed_writes_transition_and_event_together() {
        stubSaves();
        Payment payment = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        Payment failed = service.markFailed(payment.getId(), PaymentErrorCode.INSUFFICIENT_FUNDS,
                "account A-1 has 500.00 KZT but 1000.00 KZT is required");

        assertThat(failed.getStatus()).isEqualTo(PaymentStatus.FAILED);
        assertThat(failed.getFailureCode()).isEqualTo(PaymentErrorCode.INSUFFICIENT_FUNDS.code());

        ArgumentCaptor<EventEnvelope> envelope = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(outbox).append(eq(KafkaTopics.PAYMENT_EVENTS), envelope.capture());
        assertThat(envelope.getValue().eventType()).isEqualTo(KafkaTopics.Events.PAYMENT_FAILED);
        assertThat(payload(envelope).failureCode()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(payload(envelope).failureReason()).contains("is required");
    }

    @Test
    @DisplayName("a failed payment that is failed again publishes nothing twice")
    void repeated_failure_publishes_one_event() {
        stubSaves();
        Payment payment = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        payment.markFailed(PaymentErrorCode.HOLD_FAILED, "already failed");
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        service.markFailed(payment.getId(), PaymentErrorCode.HOLD_FAILED, "already failed");

        verify(transitions, never()).save(any());
        verify(outbox, never()).append(anyString(), any(EventEnvelope.class));
    }

    @Test
    @DisplayName("a reversal publishes payment.reversed")
    void mark_reversed_publishes_the_reversal() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        Payment reversed = service.markReversed(payment.getId(), "refunded in full");

        assertThat(reversed.getStatus()).isEqualTo(PaymentStatus.REVERSED);
        ArgumentCaptor<EventEnvelope> envelope = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(outbox).append(eq(KafkaTopics.PAYMENT_EVENTS), envelope.capture());
        assertThat(envelope.getValue().eventType()).isEqualTo(KafkaTopics.Events.PAYMENT_REVERSED);
    }

    // ------------------------------------------------------------------ refunds

    @Test
    @DisplayName("refunds are limited by the sum of what is already refunded, not by the last one")
    void refunds_cannot_exceed_the_payment_in_total() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(refunds.findByIdempotencyKey("refund-key")).thenReturn(Optional.empty());
        when(refunds.sumRefunded(payment.getId())).thenReturn(60_000L);

        assertThatThrownBy(() -> service.openRefund(TestPayments.customer("U-1"), payment.getId(),
                50_000L, "partial again", "refund-key"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.REFUND_EXCEEDS_PAYMENT);

        verify(refunds, never()).save(any());
    }

    @Test
    @DisplayName("a refund without an amount refunds exactly what is left")
    void a_null_amount_refunds_the_whole_payment() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(refunds.findByIdempotencyKey("refund-key")).thenReturn(Optional.empty());
        when(refunds.sumRefunded(payment.getId())).thenReturn(0L);

        PaymentStateService.RefundStart start = service.openRefund(TestPayments.customer("U-1"),
                payment.getId(), null, "customer changed their mind", "refund-key");

        assertThat(start.refund().getAmountMinor()).isEqualTo(100_000);
        assertThat(start.refund().getStatus()).isEqualTo(kz.taxi.payment.domain.RefundStatus.INITIATED);
        assertThat(start.completed()).isFalse();
    }

    @Test
    @DisplayName("a null amount refunds what is left, not the whole payment a second time")
    void a_null_amount_refunds_what_is_left_after_a_partial_refund() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(refunds.findByIdempotencyKey("refund-key")).thenReturn(Optional.empty());
        when(refunds.sumRefunded(payment.getId())).thenReturn(40_000L);

        PaymentStateService.RefundStart start = service.openRefund(TestPayments.customer("U-1"),
                payment.getId(), null, "the rest", "refund-key");

        // order-service cancels an order with exactly this null amount. Reading it as "the
        // whole payment" made the second, legitimate refund come back as
        // REFUND_EXCEEDS_PAYMENT, so the cancellation could never succeed.
        assertThat(start.refund().getAmountMinor()).isEqualTo(60_000);
    }

    @Test
    @DisplayName("a retried refund resumes the row it already created: that is what makes it safe")
    void a_retried_refund_resumes_instead_of_duplicating() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund existing = Refund.initiate(payment.getId(), 100_000, TestPayments.KZT, "full", "refund-key");
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(refunds.findByIdempotencyKey("refund-key")).thenReturn(Optional.of(existing));
        when(refunds.sumRefunded(payment.getId())).thenReturn(100_000L);

        PaymentStateService.RefundStart start = service.openRefund(TestPayments.customer("U-1"),
                payment.getId(), 100_000L, "full", "refund-key");

        assertThat(start.refund()).isSameAs(existing);
        assertThat(start.completed()).isFalse();
        verify(refunds, never()).save(any());
    }

    @Test
    @DisplayName("only the owner or an operator can refund")
    void refunds_are_authorized() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));

        AuthenticatedUser stranger = TestPayments.customer("U-2");
        assertThatThrownBy(() -> service.openRefund(stranger, payment.getId(), 10_000L, "mine now", "k"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.FORBIDDEN);

        AuthenticatedUser admin = TestPayments.admin("O-1");
        when(refunds.findByIdempotencyKey("k2")).thenReturn(Optional.empty());
        when(refunds.sumRefunded(payment.getId())).thenReturn(0L);
        assertThat(service.openRefund(admin, payment.getId(), 10_000L, "support refund", "k2")).isNotNull();
    }

    @Test
    @DisplayName("SUPPORT reads every payment but cannot refund somebody else's")
    void support_may_read_but_not_refund() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(refunds.findByIdempotencyKey(anyString())).thenReturn(Optional.empty());

        // The panel draws itself read-only for this role; the API has to agree, or the
        // rule would exist only in the browser and one curl would move the money.
        AuthenticatedUser support = TestPayments.support("O-2");
        assertThatThrownBy(() -> service.openRefund(support, payment.getId(), 10_000L, "helping", "k-support"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.FORBIDDEN);
        verify(refunds, never()).save(any());

        // The owner keeps the right to refund their own payment: the rider client uses it.
        when(refunds.sumRefunded(payment.getId())).thenReturn(0L);
        assertThat(service.openRefund(TestPayments.customer("U-1"), payment.getId(), 10_000L, "my own", "k-owner"))
                .isNotNull();
    }

    @Test
    @DisplayName("a payment that never completed cannot be refunded")
    void only_completed_payments_can_be_refunded() {
        stubSaves();
        Payment pending = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(pending.getId())).thenReturn(Optional.of(pending));
        when(refunds.findByIdempotencyKey(anyString())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.openRefund(TestPayments.customer("U-1"), pending.getId(),
                10_000L, "not yet", "k"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_COMPLETED);
    }

    @Test
    @DisplayName("a fully refunded payment cannot be refunded again")
    void reversed_payments_cannot_be_refunded_again() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        payment.markReversed("refunded in full");
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(refunds.findByIdempotencyKey(anyString())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.openRefund(TestPayments.customer("U-1"), payment.getId(),
                10_000L, "again", "k"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_REVERSIBLE);
    }

    @Test
    @DisplayName("a refund that covers the whole payment reverses it and publishes payment.reversed")
    void a_full_refund_reverses_the_payment() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 100_000, TestPayments.KZT, "full", "refund-key");
        when(refunds.findById(refund.getId())).thenReturn(Optional.of(refund));
        when(refunds.sumRefunded(payment.getId())).thenReturn(100_000L);
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));

        Refund completed = service.completeRefund(refund.getId());

        assertThat(completed.isCompleted()).isTrue();
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.REVERSED);
        ArgumentCaptor<EventEnvelope> envelope = ArgumentCaptor.forClass(EventEnvelope.class);
        verify(outbox).append(eq(KafkaTopics.PAYMENT_EVENTS), envelope.capture());
        assertThat(envelope.getValue().eventType()).isEqualTo(KafkaTopics.Events.PAYMENT_REVERSED);
    }

    @Test
    @DisplayName("a partial refund leaves the payment completed and publishes no reversal")
    void a_partial_refund_keeps_the_payment_completed() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 30_000, TestPayments.KZT, "partial", "refund-key");
        when(refunds.findById(refund.getId())).thenReturn(Optional.of(refund));
        when(refunds.sumRefunded(payment.getId())).thenReturn(30_000L);
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));

        Refund completed = service.completeRefund(refund.getId());

        assertThat(completed.isCompleted()).isTrue();
        assertThat(payment.getStatus()).isEqualTo(PaymentStatus.COMPLETED);
        verify(outbox, never()).append(anyString(), any(EventEnvelope.class));
    }

    // ------------------------------------------------------------------ recovery

    @Test
    @DisplayName("every recovery round is recorded, and the attempt counter drives the give-up rule")
    void recovery_attempts_are_counted_in_the_audit_table() {
        stubSaves();
        Payment payment = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));
        when(transitions.countByPaymentIdAndActor(payment.getId(), PaymentTransition.ACTOR_RECOVERY))
                .thenReturn(4L);

        PaymentStateService.RecoveryAttempt attempt = service.beginRecoveryAttempt(payment.getId(), 5).orElseThrow();

        assertThat(attempt.attempt()).isEqualTo(5);
        assertThat(attempt.exhausted()).isFalse();
        ArgumentCaptor<PaymentTransition> transition = ArgumentCaptor.forClass(PaymentTransition.class);
        verify(transitions).save(transition.capture());
        assertThat(transition.getValue().getActor()).isEqualTo(PaymentTransition.ACTOR_RECOVERY);
        assertThat(transition.getValue().getFromStatus()).isEqualTo(transition.getValue().getToStatus());
    }

    @Test
    @DisplayName("a terminal payment is not claimed by the recovery job at all")
    void terminal_payments_are_not_recovered() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));

        assertThat(service.beginRecoveryAttempt(payment.getId(), 5)).isEmpty();
        verify(transitions, never()).save(any());
    }

    @Test
    @DisplayName("a refund left INITIATED can be completed later without moving money twice")
    void a_stuck_refund_is_resumed_by_id() {
        stubSaves();
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 40_000, TestPayments.KZT, "partial", "refund-key");
        when(refunds.findById(refund.getId())).thenReturn(Optional.of(refund));
        when(refunds.sumRefunded(payment.getId())).thenReturn(40_000L);
        when(payments.findByIdForUpdate(payment.getId())).thenReturn(Optional.of(payment));

        assertThat(service.completeRefund(refund.getId()).isCompleted()).isTrue();
        assertThat(service.completeRefund(refund.getId()).isCompleted()).isTrue();

        verify(refunds, org.mockito.Mockito.times(1)).save(any(Refund.class));
    }

    @Test
    @DisplayName("a rejected credit marks the refund failed so a later attempt can be made")
    void a_failed_refund_stops_counting_towards_the_limit() {
        stubSaves();
        Refund refund = Refund.initiate("P-1", 40_000, TestPayments.KZT, "partial", "refund-key");
        when(refunds.findById(refund.getId())).thenReturn(Optional.of(refund));

        Refund failed = service.failRefund(refund.getId(), "account is frozen");

        assertThat(failed.getStatus()).isEqualTo(kz.taxi.payment.domain.RefundStatus.FAILED);
        assertThat(failed.getReason()).isEqualTo("account is frozen");
        assertThat(failed.getAmountMinor()).isEqualTo(40_000);
    }

    private static PaymentEvents.PaymentEvent payload(ArgumentCaptor<EventEnvelope> envelope) {
        return (PaymentEvents.PaymentEvent) envelope.getValue().payload();
    }
}
