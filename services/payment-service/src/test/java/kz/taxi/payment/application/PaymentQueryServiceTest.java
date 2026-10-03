package kz.taxi.payment.application;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.PaymentTransition;
import kz.taxi.payment.infrastructure.PaymentProperties;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.PaymentTransitionRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import kz.taxi.payment.support.TestPayments;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

import java.util.List;
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
 * The read side, including the two service-to-service reads order-service uses for
 * reconciliation.
 *
 * <p>The distinction these tests pin down: a person may only see their own
 * payments, while another service presenting the internal token may read any
 * payment — because a Kafka listener and a recovery job have no user identity, and
 * refusing them would leave a paid order looking unpaid. Operators sit on the wide
 * side of reads (ADMIN and SUPPORT both list everything) and on the narrow side of
 * writes, which the refund tests in {@code PaymentStateServiceTest} pin down.
 */
class PaymentQueryServiceTest {

    private PaymentRepository payments;
    private PaymentTransitionRepository transitions;
    private RefundRepository refunds;
    private PaymentQueryService queries;

    @BeforeEach
    void setUp() {
        payments = mock(PaymentRepository.class);
        transitions = mock(PaymentTransitionRepository.class);
        refunds = mock(RefundRepository.class);
        queries = new PaymentQueryService(payments, transitions, refunds, new PaymentMapper(),
                new PaymentProperties());
    }

    private Payment completedPayment(String owner, String orderId) {
        Payment payment = TestPayments.merchant(owner, "A-1", orderId, 100_000, 1_500);
        return TestPayments.completed(payment);
    }

    @Test
    @DisplayName("the owner sees their payment with its full transition history")
    void the_owner_sees_the_payment_with_its_history() {
        Payment payment = completedPayment("U-1", "O-1");
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));
        when(transitions.findByPaymentIdOrderByCreatedAtAsc(payment.getId())).thenReturn(List.of(
                PaymentTransition.of(payment.getId(), null, PaymentStatus.INITIATED, "created", "api"),
                PaymentTransition.of(payment.getId(), PaymentStatus.PENDING, PaymentStatus.COMPLETED, null, "saga")));

        PaymentDtos.PaymentDetailsResponse details = queries.get(TestPayments.customer("U-1"), payment.getId());

        assertThat(details.payment().paymentId()).isEqualTo(payment.getId());
        assertThat(details.payment().status()).isEqualTo("COMPLETED");
        assertThat(details.transitions()).extracting(PaymentDtos.PaymentTransitionResponse::toStatus)
                .containsExactly("INITIATED", "COMPLETED");
    }

    @Test
    @DisplayName("somebody else's payment is a 403, not a 404: the caller is allowed to know it exists")
    void another_users_payment_is_forbidden() {
        Payment payment = completedPayment("U-1", "O-1");
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        AuthenticatedUser stranger = TestPayments.customer("U-2");
        assertThatThrownBy(() -> queries.get(stranger, payment.getId()))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.FORBIDDEN);

        assertThatThrownBy(() -> queries.refunds(stranger, payment.getId()))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.FORBIDDEN);
    }

    @Test
    @DisplayName("an operator may read anybody's payment, which is what support needs")
    void an_operator_may_read_any_payment() {
        Payment payment = completedPayment("U-1", "O-1");
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        assertThat(queries.get(TestPayments.admin("O-1"), payment.getId()).payment().paymentId())
                .isEqualTo(payment.getId());
    }

    @Test
    @DisplayName("the internal read needs no caller at all: the token is the credential")
    void the_internal_read_does_not_need_a_caller() {
        Payment payment = completedPayment("U-1", "O-1");
        when(payments.findById(payment.getId())).thenReturn(Optional.of(payment));

        PaymentDtos.PaymentResponse response = queries.getInternal(payment.getId());

        assertThat(response.paymentId()).isEqualTo(payment.getId());
        assertThat(response.orderId()).isEqualTo("O-1");
        assertThat(response.feeMinor()).isEqualTo(1_500);
        assertThat(response.totalMinor()).isEqualTo(101_500);
        verify(transitions, never()).findByPaymentIdOrderByCreatedAtAsc(anyString());
    }

    @Test
    @DisplayName("the internal order lookup returns the settled payment, not a stale duplicate")
    void the_internal_order_lookup_prefers_the_settled_payment() {
        Payment pending = TestPayments.pending(TestPayments.merchant("U-1", "A-1", "O-1", 100_000, 1_500));
        Payment completed = completedPayment("U-1", "O-1");
        when(payments.findByOrderIdOrderByCreatedAtDesc("O-1")).thenReturn(List.of(pending, completed));

        assertThat(queries.byOrderInternal("O-1").status()).isEqualTo("COMPLETED");
    }

    @Test
    @DisplayName("an order that was never paid is a 404 for both callers")
    void an_unpaid_order_is_not_found() {
        when(payments.findByOrderIdOrderByCreatedAtDesc("O-2")).thenReturn(List.of());

        assertThatThrownBy(() -> queries.byOrderInternal("O-2"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_FOUND);

        assertThatThrownBy(() -> queries.byOrder(TestPayments.customer("U-1"), "O-2"))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.PAYMENT_NOT_FOUND);
    }

    @Test
    @DisplayName("a normal caller lists only their own payments, newest first, with the size clamped")
    void listing_is_scoped_to_the_caller() {
        Payment payment = completedPayment("U-1", "O-1");
        Page<Payment> page = new PageImpl<>(List.of(payment));
        when(payments.findByOwnerUserIdAndStatusOrderByCreatedAtDesc(eq("U-1"), eq(PaymentStatus.COMPLETED),
                any(Pageable.class))).thenReturn(page);

        var result = queries.list(TestPayments.customer("U-1"), PaymentStatus.COMPLETED, 0, 5_000);

        assertThat(result.items()).hasSize(1);
        assertThat(result.totalElements()).isEqualTo(1);
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(payments).findByOwnerUserIdAndStatusOrderByCreatedAtDesc(eq("U-1"), eq(PaymentStatus.COMPLETED),
                pageable.capture());
        assertThat(pageable.getValue().getPageSize())
                .as("a client asking for 5000 rows must not be able to ask for 5000 rows")
                .isEqualTo(100);
    }

    @Test
    @DisplayName("an administrator lists every payment, and can filter by status")
    void an_administrator_sees_everything() {
        when(payments.findByOwnerUserIdAndStatusOrderByCreatedAtDesc(anyString(), any(), any()))
                .thenReturn(new PageImpl<>(List.of()));
        when(payments.findByStatusOrderByCreatedAtDesc(eq(PaymentStatus.FAILED), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(completedPayment("U-9", "O-9"))));

        var result = queries.list(TestPayments.admin("O-1"), PaymentStatus.FAILED, 0, 20);

        assertThat(result.items()).hasSize(1);
        verify(payments, never()).findByOwnerUserIdOrderByCreatedAtDesc(anyString(), any());
        verify(payments, never()).findByOwnerUserIdAndStatusOrderByCreatedAtDesc(anyString(), any(), any());
    }

    @Test
    @DisplayName("SUPPORT also lists every payment: reading is what the operator role is for")
    void support_lists_everything_but_writes_nothing() {
        Payment other = completedPayment("U-9", "O-9");
        when(payments.findAllByOrderByCreatedAtDesc(any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(other)));

        var result = queries.list(TestPayments.support("O-2"), null, 0, 20);

        assertThat(result.items()).hasSize(1);
        assertThat(result.items().get(0).paymentId()).isEqualTo(other.getId());
        // A support agent holding a payment number must be able to find the row, which is
        // the whole point of the admin panel; refunds for this role are refused separately
        // in PaymentStateServiceTest, so the read path can stay wide.
        verify(payments, never()).findByOwnerUserIdOrderByCreatedAtDesc(anyString(), any());
        verify(payments, never()).findByOwnerUserIdAndStatusOrderByCreatedAtDesc(anyString(), any(), any());
    }
}
