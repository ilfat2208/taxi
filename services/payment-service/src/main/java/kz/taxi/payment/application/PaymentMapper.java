package kz.taxi.payment.application;

import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentTransition;
import kz.taxi.payment.domain.Refund;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Entity to DTO mapping.
 *
 * <p>The only place where a persistence entity is allowed to become something a
 * client sees: enums become strings, ids stay strings, and nothing that exists
 * only for the saga (the step marker) leaks out.
 */
@Component
public class PaymentMapper {

    public PaymentDtos.PaymentResponse toResponse(Payment payment) {
        return new PaymentDtos.PaymentResponse(
                payment.getId(),
                payment.getPaymentNumber(),
                payment.getType().name(),
                payment.getStatus().name(),
                payment.getOwnerUserId(),
                payment.getSourceAccountId(),
                payment.getTargetAccountId(),
                payment.getMerchantId(),
                payment.getOrderId(),
                payment.getAmountMinor(),
                payment.getFeeMinor(),
                payment.getTotalMinor(),
                payment.getCurrency().name(),
                payment.getDescription(),
                payment.getFailureCode(),
                payment.getFailureReason(),
                payment.getCreatedAt(),
                payment.getUpdatedAt(),
                payment.getCompletedAt());
    }

    public PaymentDtos.PaymentTransitionResponse toResponse(PaymentTransition transition) {
        return new PaymentDtos.PaymentTransitionResponse(
                transition.getId(),
                transition.getFromStatus() == null ? null : transition.getFromStatus().name(),
                transition.getToStatus().name(),
                transition.getReason(),
                transition.getActor(),
                transition.getCreatedAt());
    }

    public PaymentDtos.PaymentDetailsResponse toDetails(Payment payment, List<PaymentTransition> transitions) {
        return new PaymentDtos.PaymentDetailsResponse(toResponse(payment),
                transitions.stream().map(this::toResponse).toList());
    }

    public PaymentDtos.RefundResponse toResponse(Refund refund) {
        return new PaymentDtos.RefundResponse(
                refund.getId(),
                refund.getPaymentId(),
                refund.getAmountMinor(),
                refund.getCurrency().name(),
                refund.getStatus().name(),
                refund.getReason(),
                refund.getCreatedAt(),
                refund.getUpdatedAt());
    }
}
