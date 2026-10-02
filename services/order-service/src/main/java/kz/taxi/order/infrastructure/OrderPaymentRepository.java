package kz.taxi.order.infrastructure;

import kz.taxi.order.domain.OrderPayment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * Per-merchant payments of an order.
 *
 * <p>Every lookup is either "the payments of this order" (the saga, the API, the
 * recovery job) or "the order this payment belongs to" (an event that named no
 * order). There is deliberately no query that returns "the payment of an order":
 * with one payment per merchant that question has no single answer, and a method
 * that pretended otherwise would be the bug this change removes.
 */
public interface OrderPaymentRepository extends JpaRepository<OrderPayment, String> {

    /** The order's payments, in the order the saga charges them: ascending merchant id. */
    List<OrderPayment> findByOrderIdOrderByMerchantIdAsc(String orderId);

    /** One merchant's line of one order; {@code uq_order_payment_merchant} makes this a point lookup. */
    Optional<OrderPayment> findByOrderIdAndMerchantId(String orderId, String merchantId);

    /** Which order a payment belongs to, for a {@code payment.*} event and for reconciliation. */
    Optional<OrderPayment> findFirstByPaymentId(String paymentId);
}
