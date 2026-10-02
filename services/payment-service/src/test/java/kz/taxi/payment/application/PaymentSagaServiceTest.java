package kz.taxi.payment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentFees;
import kz.taxi.payment.domain.PaymentIntent;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.AccountServiceClient.CaptureRequest;
import kz.taxi.payment.infrastructure.AccountServiceClient.CaptureResult;
import kz.taxi.payment.infrastructure.AccountServiceClient.CreditRequest;
import kz.taxi.payment.infrastructure.AccountServiceClient.CreditResult;
import kz.taxi.payment.infrastructure.AccountServiceClient.HoldRequest;
import kz.taxi.payment.infrastructure.AccountServiceClient.HoldSnapshot;
import kz.taxi.payment.infrastructure.AccountServiceClient.ResolvedAccount;
import kz.taxi.payment.infrastructure.PaymentProperties;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.support.TestPayments;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The saga's orchestration: the order of the calls, and what happens when one of
 * them fails.
 *
 * <p>Two things are being defended here. First, that the durable step is always
 * written <em>before</em> the remote call it describes, because that ordering is
 * the only reason a crashed payment is recoverable at all. Second, that a failure
 * never leaves money in the wrong place: a hold with no capture must be released,
 * and a capture that reported a failure must be verified before it is undone.
 */
class PaymentSagaServiceTest {

    private static final String HOLD_ID = TestPayments.HOLD_ID;
    private static final Currency KZT = Currency.KZT;

    private AccountServiceClient accounts;
    private PaymentStateService state;
    private PaymentRepository payments;
    private PaymentSagaService saga;

    private final AtomicReference<Payment> created = new AtomicReference<>();

    @BeforeEach
    void setUp() {
        accounts = mock(AccountServiceClient.class);
        state = mock(PaymentStateService.class);
        payments = mock(PaymentRepository.class);
        saga = new PaymentSagaService(accounts, state, payments, new PaymentMapper(), new ObjectMapper(),
                new PaymentProperties());
    }

    // ------------------------------------------------------------------ fixtures

    private void stubSourceAccount() {
        when(accounts.getAccount("A-1")).thenReturn(new AccountServiceClient.AccountSnapshot(
                "A-1", "U-1", "+77001234567", "KZT", "ACTIVE", 500_000, 0, 500_000));
    }

    /** Captures the intent and the fee breakdown the saga computed, and returns a real entity. */
    private void stubInitiate() {
        when(state.initiate(any(PaymentIntent.class), any(PaymentFees.FeeBreakdown.class))).thenAnswer(call -> {
            Payment payment = Payment.initiate(call.getArgument(0), call.getArgument(1));
            created.set(payment);
            return payment;
        });
    }

    private void stubSteps() {
        when(state.markPending(anyString())).thenAnswer(call -> created.get());
        when(state.recordHold(anyString(), anyString())).thenAnswer(call -> created.get());
        when(state.beginCapture(anyString(), anyString())).thenAnswer(call -> created.get());
        when(state.beginRelease(anyString(), anyString(), anyString())).thenAnswer(call -> created.get());
        when(state.markCompleted(anyString())).thenAnswer(call -> {
            Payment payment = created.get();
            payment.markPending();
            payment.markCompleted();
            return payment;
        });
        when(state.markFailed(anyString(), any(), anyString())).thenAnswer(call -> {
            Payment payment = created.get();
            payment.markPending();
            payment.markFailed(call.getArgument(1), call.getArgument(2));
            return payment;
        });
    }

    private static HoldSnapshot hold(String status) {
        return new HoldSnapshot(HOLD_ID, "A-1", 100_000, "KZT", status, 400_000, null, false);
    }

    private static CaptureResult captured() {
        return new CaptureResult(HOLD_ID, "CAPTURED", "TX-1", "A-1", "A-2", 100_000, "KZT", false);
    }

    private PaymentDtos.TransferRequest transferRequest() {
        return new PaymentDtos.TransferRequest("A-1", "+77001112233", null, 100_000, KZT, "lunch");
    }

    // ------------------------------------------------------------------ happy path

    @Test
    @DisplayName("a transfer reserves funds, then captures them, in exactly that order")
    void transfer_reserves_then_captures() {
        stubSourceAccount();
        when(accounts.resolveByPhone("+77001112233", KZT))
                .thenReturn(new ResolvedAccount("A-2", "U-2", "KZT", "ACTIVE"));
        stubInitiate();
        stubSteps();
        when(accounts.placeHold(any())).thenReturn(hold("ACTIVE"));
        when(accounts.capture(eq(HOLD_ID), any())).thenReturn(captured());

        PaymentDtos.PaymentResponse response = saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1");

        assertThat(response.status()).isEqualTo("COMPLETED");
        assertThat(response.ownerUserId()).isEqualTo("U-1");
        assertThat(response.targetAccountId()).isEqualTo("A-2");
        assertThat(response.totalMinor()).isEqualTo(100_000);

        ArgumentCaptor<HoldRequest> holdRequest = ArgumentCaptor.forClass(HoldRequest.class);
        verify(accounts).placeHold(holdRequest.capture());
        assertThat(holdRequest.getValue().referenceType()).isEqualTo(AccountServiceClient.REFERENCE_TYPE_PAYMENT);
        assertThat(holdRequest.getValue().referenceId()).isEqualTo(response.paymentId());
        assertThat(holdRequest.getValue().idempotencyKey())
                .as("the payment id is the hold's idempotency key, so a retried hold cannot reserve twice")
                .isEqualTo(response.paymentId());
        assertThat(holdRequest.getValue().amountMinor()).isEqualTo(100_000);

        ArgumentCaptor<CaptureRequest> captureRequest = ArgumentCaptor.forClass(CaptureRequest.class);
        verify(accounts).capture(eq(HOLD_ID), captureRequest.capture());
        assertThat(captureRequest.getValue().targetAccountId()).isEqualTo("A-2");
        assertThat(captureRequest.getValue().operation()).isEqualTo("P2P_TRANSFER");

        InOrder order = inOrder(accounts, state);
        order.verify(accounts).getAccount("A-1");
        order.verify(accounts).resolveByPhone("+77001112233", KZT);
        order.verify(state).initiate(any(PaymentIntent.class), any(PaymentFees.FeeBreakdown.class));
        order.verify(state).markPending(response.paymentId());
        order.verify(accounts).placeHold(any());
        order.verify(state).recordHold(response.paymentId(), HOLD_ID);
        order.verify(state).beginCapture(response.paymentId(), HOLD_ID);
        order.verify(accounts).capture(eq(HOLD_ID), any());
        order.verify(state).markCompleted(response.paymentId());
    }

    @Test
    @DisplayName("a merchant payment holds amount plus fee and settles without a target account")
    void merchant_payment_holds_the_total_and_settles_to_suspense() {
        stubSourceAccount();
        stubInitiate();
        stubSteps();
        when(accounts.placeHold(any())).thenReturn(hold("ACTIVE"));
        when(accounts.capture(eq(HOLD_ID), any())).thenReturn(captured());

        PaymentDtos.PaymentResponse response = saga.merchantPayment(TestPayments.customer("U-1"),
                new PaymentDtos.MerchantPaymentRequest("A-1", "M-1", 100_000, KZT, "order 42", "O-1"), "key-m");

        assertThat(response.status()).isEqualTo("COMPLETED");
        assertThat(response.amountMinor()).isEqualTo(100_000);
        assertThat(response.feeMinor()).isEqualTo(1_500);
        assertThat(response.totalMinor()).isEqualTo(101_500);
        assertThat(response.orderId()).isEqualTo("O-1");

        ArgumentCaptor<HoldRequest> holdRequest = ArgumentCaptor.forClass(HoldRequest.class);
        verify(accounts).placeHold(holdRequest.capture());
        assertThat(holdRequest.getValue().amountMinor())
                .as("the payer pays the order amount plus the marketplace fee")
                .isEqualTo(101_500);

        ArgumentCaptor<CaptureRequest> captureRequest = ArgumentCaptor.forClass(CaptureRequest.class);
        verify(accounts).capture(eq(HOLD_ID), captureRequest.capture());
        assertThat(captureRequest.getValue().targetAccountId()).isNull();
        assertThat(captureRequest.getValue().operation()).isEqualTo("MERCHANT_PAYMENT");
        assertThat(captureRequest.getValue().referenceId()).isEqualTo(response.paymentId());
    }

    // ------------------------------------------------------------------ compensation

    @Test
    @DisplayName("a capture that failed after a successful hold gives the money back, then fails the payment")
    void a_failed_capture_releases_the_hold_and_fails_the_payment() {
        stubSourceAccount();
        when(accounts.resolveByPhone(anyString(), any()))
                .thenReturn(new ResolvedAccount("A-2", "U-2", "KZT", "ACTIVE"));
        stubInitiate();
        stubSteps();
        when(accounts.placeHold(any())).thenReturn(hold("ACTIVE"));
        when(accounts.capture(eq(HOLD_ID), any()))
                .thenThrow(DomainException.of(PaymentErrorCode.HOLD_FAILED, "account service refused the capture"));
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("ACTIVE")));

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.HOLD_FAILED);

        InOrder order = inOrder(accounts, state);
        order.verify(accounts).capture(eq(HOLD_ID), any());
        order.verify(accounts).findHold(HOLD_ID);
        order.verify(state).beginRelease(eq(created.get().getId()), eq(HOLD_ID), anyString());
        order.verify(accounts).release(eq(HOLD_ID), anyString());
        order.verify(state).markFailed(eq(created.get().getId()), eq(PaymentErrorCode.HOLD_FAILED), anyString());
        verify(state, never()).markCompleted(anyString());
    }

    @Test
    @DisplayName("a capture that reported an error but landed is completed, not compensated")
    void a_capture_that_actually_landed_is_not_compensated() {
        stubSourceAccount();
        when(accounts.resolveByPhone(anyString(), any()))
                .thenReturn(new ResolvedAccount("A-2", "U-2", "KZT", "ACTIVE"));
        stubInitiate();
        stubSteps();
        when(accounts.placeHold(any())).thenReturn(hold("ACTIVE"));
        when(accounts.capture(eq(HOLD_ID), any()))
                .thenThrow(DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE, "read timed out"));
        when(accounts.findHold(HOLD_ID)).thenReturn(Optional.of(hold("CAPTURED")));

        PaymentDtos.PaymentResponse response = saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1");

        assertThat(response.status()).isEqualTo("COMPLETED");
        verify(accounts, never()).release(anyString(), anyString());
        verify(state, never()).markFailed(anyString(), any(), anyString());
    }

    @Test
    @DisplayName("when the hold cannot be read back, nothing is decided and the recovery job keeps the case")
    void an_unverifiable_capture_leaves_the_payment_pending() {
        stubSourceAccount();
        when(accounts.resolveByPhone(anyString(), any()))
                .thenReturn(new ResolvedAccount("A-2", "U-2", "KZT", "ACTIVE"));
        stubInitiate();
        stubSteps();
        when(accounts.placeHold(any())).thenReturn(hold("ACTIVE"));
        when(accounts.capture(eq(HOLD_ID), any()))
                .thenThrow(DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE, "read timed out"));
        when(accounts.findHold(HOLD_ID))
                .thenThrow(DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE, "still down"));

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE);

        verify(accounts, never()).release(anyString(), anyString());
        verify(state, never()).markFailed(anyString(), any(), anyString());
        verify(state, never()).markCompleted(anyString());
    }

    @Test
    @DisplayName("a hold that was refused fails the payment and returns the bank's reason to the caller")
    void a_refused_hold_fails_the_payment() {
        stubSourceAccount();
        when(accounts.resolveByPhone(anyString(), any()))
                .thenReturn(new ResolvedAccount("A-2", "U-2", "KZT", "ACTIVE"));
        stubInitiate();
        stubSteps();
        when(accounts.placeHold(any()))
                .thenThrow(DomainException.of(PaymentErrorCode.INSUFFICIENT_FUNDS, "account A-1 has 5.00 KZT"));

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.INSUFFICIENT_FUNDS);

        verify(state).markFailed(eq(created.get().getId()), eq(PaymentErrorCode.INSUFFICIENT_FUNDS), anyString());
        verify(accounts, never()).capture(anyString(), any());
        verify(state, never()).markCompleted(anyString());
    }

    // ------------------------------------------------------------------ guards

    @Test
    @DisplayName("a transfer to your own account is refused before any money is reserved")
    void self_transfer_is_refused_before_anything_is_created() {
        stubSourceAccount();
        when(accounts.resolveByPhone(anyString(), any()))
                .thenReturn(new ResolvedAccount("A-1", "U-1", "KZT", "ACTIVE"));

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.SELF_TRANSFER_NOT_ALLOWED);

        verify(state, never()).initiate(any(PaymentIntent.class), any(PaymentFees.FeeBreakdown.class));
        verify(accounts, never()).placeHold(any());
    }

    @Test
    @DisplayName("an account that is not the caller's cannot be the source of a payment")
    void somebody_elses_account_cannot_be_used() {
        when(accounts.getAccount("A-1")).thenReturn(new AccountServiceClient.AccountSnapshot(
                "A-1", "U-9", "+77009999999", "KZT", "ACTIVE", 500_000, 0, 500_000));

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED);

        verify(state, never()).initiate(any(PaymentIntent.class), any(PaymentFees.FeeBreakdown.class));
    }

    @Test
    @DisplayName("an unknown recipient is a 404 and never reaches the account service to reserve funds")
    void an_unknown_recipient_stops_the_saga_before_the_hold() {
        stubSourceAccount();
        when(accounts.resolveByPhone(anyString(), any()))
                .thenThrow(DomainException.of(PaymentErrorCode.TARGET_ACCOUNT_NOT_FOUND, "no active KZT account"));

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"), transferRequest(), "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.TARGET_ACCOUNT_NOT_FOUND);

        verify(state, never()).initiate(any(PaymentIntent.class), any(PaymentFees.FeeBreakdown.class));
        verify(accounts, never()).placeHold(any());
    }

    @Test
    @DisplayName("a transfer in another currency than the account is refused")
    void currency_mismatch_is_refused() {
        stubSourceAccount();

        assertThatThrownBy(() -> saga.transfer(TestPayments.customer("U-1"),
                new PaymentDtos.TransferRequest("A-1", "+77001112233", null, 100_000, Currency.USD, "lunch"),
                "key-1"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.INVALID_AMOUNT);

        verify(state, never()).initiate(any(PaymentIntent.class), any(PaymentFees.FeeBreakdown.class));
    }

    // ------------------------------------------------------------------ refunds

    @Test
    @DisplayName("a refund credits the payer under the refund reference, which is what makes a retry safe")
    void refund_credits_the_payer_referenced_by_the_refund_id() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 40_000, KZT, "partial refund", "refund-key");
        when(state.openRefund(any(), eq(payment.getId()), eq(40_000L), any(), eq("refund-key")))
                .thenReturn(new PaymentStateService.RefundStart(refund, false));
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));
        when(accounts.credit(any())).thenReturn(new CreditResult("A-1", "TX-9", 40_000, "KZT", 140_000, false));
        when(state.completeRefund(refund.getId())).thenAnswer(call -> {
            refund.complete();
            return refund;
        });

        PaymentDtos.RefundResponse response = saga.refund(TestPayments.customer("U-1"), payment.getId(),
                new PaymentDtos.RefundRequest(40_000L, "partial refund"), "refund-key");

        assertThat(response.status()).isEqualTo("COMPLETED");
        assertThat(response.amountMinor()).isEqualTo(40_000);

        ArgumentCaptor<CreditRequest> credit = ArgumentCaptor.forClass(CreditRequest.class);
        verify(accounts).credit(credit.capture());
        assertThat(credit.getValue().accountId()).isEqualTo("A-1");
        assertThat(credit.getValue().referenceType()).isEqualTo(AccountServiceClient.REFERENCE_TYPE_REFUND);
        assertThat(credit.getValue().referenceId()).isEqualTo(refund.getId());
        assertThat(credit.getValue().operation()).isEqualTo("REFUND");
    }

    @Test
    @DisplayName("a replayed refund does not credit a second time")
    void a_completed_refund_is_replayed_without_moving_money() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 40_000, KZT, "partial refund", "refund-key");
        refund.complete();
        when(state.openRefund(any(), anyString(), any(), any(), anyString()))
                .thenReturn(new PaymentStateService.RefundStart(refund, true));

        PaymentDtos.RefundResponse response = saga.refund(TestPayments.customer("U-1"), payment.getId(),
                new PaymentDtos.RefundRequest(null, "again"), "refund-key");

        assertThat(response.status()).isEqualTo("COMPLETED");
        verify(accounts, never()).credit(any());
    }

    @Test
    @DisplayName("a refused credit fails the refund, because the money definitely did not move")
    void a_refused_credit_fails_the_refund() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 40_000, KZT, "partial refund", "refund-key");
        when(state.openRefund(any(), anyString(), any(), any(), anyString()))
                .thenReturn(new PaymentStateService.RefundStart(refund, false));
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));
        when(accounts.credit(any()))
                .thenThrow(DomainException.of(PaymentErrorCode.HOLD_FAILED, "account A-1 is frozen"));

        assertThatThrownBy(() -> saga.refund(TestPayments.customer("U-1"), payment.getId(),
                new PaymentDtos.RefundRequest(40_000L, "partial refund"), "refund-key"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.HOLD_FAILED);

        verify(state).failRefund(refund.getId(), "account A-1 is frozen");
    }

    @Test
    @DisplayName("an unverifiable credit leaves the refund INITIATED: retrying it is free, failing it is not")
    void an_ambiguous_credit_keeps_the_refund_open() {
        Payment payment = TestPayments.completed(TestPayments.p2p("U-1", "A-1", "A-2", 100_000));
        Refund refund = Refund.initiate(payment.getId(), 40_000, KZT, "partial refund", "refund-key");
        when(state.openRefund(any(), anyString(), any(), any(), anyString()))
                .thenReturn(new PaymentStateService.RefundStart(refund, false));
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));
        when(accounts.credit(any()))
                .thenThrow(DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE, "read timed out"));

        assertThatThrownBy(() -> saga.refund(TestPayments.customer("U-1"), payment.getId(),
                new PaymentDtos.RefundRequest(40_000L, "partial refund"), "refund-key"))
                .isInstanceOf(DomainException.class);

        verify(state, never()).failRefund(anyString(), anyString());
    }
}
