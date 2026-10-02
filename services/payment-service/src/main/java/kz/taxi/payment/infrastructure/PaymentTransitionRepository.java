package kz.taxi.payment.infrastructure;

import kz.taxi.payment.domain.PaymentTransition;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PaymentTransitionRepository extends JpaRepository<PaymentTransition, String> {

    List<PaymentTransition> findByPaymentIdOrderByCreatedAtAsc(String paymentId);

    /**
     * How many times the recovery job has looked at this payment.
     *
     * <p>Attempts live in the audit table rather than in a counter column because
     * the schema is frozen and because "we tried N times and gave up" belongs in
     * the payment's history, not in a number somebody has to trust.
     */
    long countByPaymentIdAndActor(String paymentId, String actor);
}
