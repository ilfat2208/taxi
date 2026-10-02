package kz.taxi.payment.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.AccountServiceClient.CaptureRequest;
import kz.taxi.payment.infrastructure.AccountServiceClient.CaptureResult;
import kz.taxi.payment.infrastructure.AccountServiceClient.HoldSnapshot;
import kz.taxi.payment.infrastructure.PaymentProperties;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import kz.taxi.payment.support.TestPayments;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The recovery job's decision table.
 *
 * <p>This is the code that runs when nobody is watching, on a payment whose driving
 * process is gone, and it decides whether money moves. Every case below is a state
 * a crash can actually produce, and the expected answer is always the one the
 * account service can prove — never a guess.
 */
class PaymentRecoveryServiceTest {

    private static final String HOLD_ID = TestPayments.HOLD_ID;

    private AccountServiceClient accounts;
    private PaymentStateService state;
    private PaymentRepository payments;
    private PaymentRecoveryService recovery;

    @BeforeEach
    void setUp() {
        accounts = mock(AccountServiceClient.class);
        state = mock(PaymentStateService.class);
        payments = mock(PaymentRepository.class);
        recovery = new PaymentRecoveryService(accounts, state, payments, mock(RefundRepository.class),
                new PaymentProperties());
    }

    /** Claims the payment for recovery, as {@link PaymentStateService#beginRecoveryAttempt} would. */
    private void claim(Payment payment, long attempt, boolean exhausted) {
        when(state.beginRecoveryAttempt(payment.getId(), 5))
                .thenReturn(Optional.of(new PaymentStateService.RecoveryAttempt(payment, attempt, exhausted)));
    }

    private static HoldSnapshot hold(String status) {
        return new HoldSnapshot(HOLD_ID, "A-1", 100_000, "KZT", status, 400_000, null, false);
    }

    @Test
    @DisplayName("an INITIATED payment never reserved funds, so it is failed without asking anyone")
    void initiated_payments_are_failed_without_a_remote_call() {
        Payment payment = TestPayments.p2p("U-1", "A-1", "A-2", 100_000);
        claim(payment, 1, false);

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts, never()).placeHold(any());
        verify(accounts, never()).findActiveHold(anyString(), anyString(), anyString());
        verify(accounts, never()).capture(anyString(), any());
        verify(state).markFailed(eq(payment.getId()), eq(PaymentErrorCode.HOLD_FAILED), anyString());
    }

    @Test
    @DisplayName("a reservation that is still active is captured and the payment completes")
    void an_active_hold_is_captured_and_completed() {
        Payment payment = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        claim(payment, 1, false);
        when(accounts.findActiveHold(AccountServiceClient.REFERENCE_TYPE_PAYMENT, payment.getId(), "A-1"))
                .thenReturn(Optional.of(hold("ACTIVE")));
        when(accounts.capture(eq(HOLD_ID), any()))
                .thenReturn(new CaptureResult(HOLD_ID, "CAPTURED", "TX-1", "A-1", "A-2", 100_000, "KZT", false));

        assertThat(recovery.recover(payment.getId())).isTrue();

        ArgumentCaptor<CaptureRequest> capture = ArgumentCaptor.forClass(CaptureRequest.class);
        verify(accounts).capture(eq(HOLD_ID), capture.capture());
        assertThat(capture.getValue().targetAccountId()).isEqualTo("A-2");
        assertThat(capture.getValue().operation()).isEqualTo("P2P_TRANSFER");
        verify(state).markCompleted(payment.getId());
        verify(state, never()).markFailed(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("a hold request that was never confirmed fails the payment instead of reserving new money")
    void an_unconfirmed_hold_fails_the_payment() {
        Payment payment = TestPayments.pending(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        claim(payment, 1, false);
        when(accounts.findActiveHold(AccountServiceClient.REFERENCE_TYPE_PAYMENT, payment.getId(), "A-1"))
                .thenReturn(Optional.empty());

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts, never()).placeHold(any());
        verify(accounts, never()).capture(anyString(), any());
        verify(state).markFailed(eq(payment.getId()), eq(PaymentErrorCode.HOLD_FAILED), anyString());
    }

    @Test
    @DisplayName("a hold that was already captured completes the payment: the money did move")
    void an_already_captured_hold_completes_the_payment() {
        Payment payment = TestPayments.capturing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 1, false);
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("CAPTURED")));

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts, never()).capture(anyString(), any());
        verify(state).markCompleted(payment.getId());
    }

    @Test
    @DisplayName("a capture that never landed is retried, because re-capturing is idempotent")
    void a_capture_that_never_landed_is_retried() {
        Payment payment = TestPayments.capturing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 2, false);
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("ACTIVE")));
        when(accounts.capture(eq(HOLD_ID), any()))
                .thenReturn(new CaptureResult(HOLD_ID, "CAPTURED", "TX-1", "A-1", "A-2", 100_000, "KZT", true));

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts).capture(eq(HOLD_ID), any());
        verify(state).markCompleted(payment.getId());
    }

    @Test
    @DisplayName("a hold that expired or was released fails the payment: no money moved")
    void a_released_hold_fails_the_payment() {
        Payment payment = TestPayments.capturing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 1, false);
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("EXPIRED")));

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts, never()).capture(anyString(), any());
        verify(accounts, never()).release(anyString(), anyString());
        verify(state).markFailed(eq(payment.getId()), eq(PaymentErrorCode.HOLD_FAILED), anyString());
    }

    @Test
    @DisplayName("a saga that was already compensating finishes the compensation")
    void a_compensating_saga_releases_and_fails() {
        Payment payment = TestPayments.releasing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 1, false);
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("ACTIVE")));

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts).release(eq(HOLD_ID), anyString());
        verify(accounts, never()).capture(anyString(), any());
        verify(state).markFailed(eq(payment.getId()), eq(PaymentErrorCode.HOLD_FAILED), anyString());
    }

    @Test
    @DisplayName("a compensation that was based on a lie completes the payment after all")
    void a_compensation_backed_by_a_real_capture_completes() {
        Payment payment = TestPayments.releasing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 1, false);
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("CAPTURED")));

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts, never()).release(anyString(), anyString());
        verify(state).markCompleted(payment.getId());
    }

    @Test
    @DisplayName("a payment that survives its attempt budget is failed instead of retried forever")
    void an_exhausted_payment_is_failed() {
        Payment payment = TestPayments.capturing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 6, true);
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("ACTIVE")));

        assertThat(recovery.recover(payment.getId())).isTrue();

        verify(accounts, never()).capture(anyString(), any());
        verify(accounts).release(eq(HOLD_ID), anyString());
        verify(state).markFailed(eq(payment.getId()), eq(PaymentErrorCode.HOLD_FAILED), anyString());
    }

    @Test
    @DisplayName("a payment that is no longer stuck is left alone")
    void a_settled_payment_is_not_recovered() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        when(state.beginRecoveryAttempt(payment.getId(), 5)).thenReturn(Optional.empty());

        assertThat(recovery.recover(payment.getId())).isFalse();

        verify(state, never()).markCompleted(anyString());
        verify(state, never()).markFailed(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("an unavailable account service leaves the payment for the next round")
    void an_unavailable_account_service_does_not_resolve_anything() {
        Payment payment = TestPayments.capturing(TestPayments.p2p("U-1", "A-1", "A-2", 100_000), HOLD_ID);
        claim(payment, 1, false);
        when(accounts.findHold(HOLD_ID))
                .thenThrow(DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE, "connection refused"));

        assertThatThrownBy(() -> recovery.recover(payment.getId()))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE);

        verify(state, never()).markFailed(anyString(), any(), anyString());
        verify(state, never()).markCompleted(anyString());
    }
}
