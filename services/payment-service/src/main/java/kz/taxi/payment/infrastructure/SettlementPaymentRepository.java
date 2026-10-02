package kz.taxi.payment.infrastructure;

import kz.taxi.payment.domain.SettlementPayment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SettlementPaymentRepository extends JpaRepository<SettlementPayment, String> {

    List<SettlementPayment> findBySettlementId(String settlementId);

    boolean existsByPaymentId(String paymentId);

    long countBySettlementId(String settlementId);
}
