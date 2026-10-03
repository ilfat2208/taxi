package kz.taxi.payment.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.domain.Payment;

/**
 * "May this caller see or move this payment?"
 *
 * <p>One helper instead of a scattered check, because the answer must be the same
 * everywhere: the owner, an operator (SUPPORT) or an administrator. The
 * platform's {@code CurrentUser#requireAccessTo} does exactly this for code that
 * runs inside a request; this variant takes the caller as an argument so that the
 * same rule can be unit-tested without a security context.
 */
final class PaymentAccess {

    private PaymentAccess() {
    }

    static void require(AuthenticatedUser caller, Payment payment) {
        if (caller == null) {
            throw DomainException.unauthorized("authentication required");
        }
        if (!caller.canAccess(payment.getOwnerUserId())) {
            throw DomainException.forbidden("user {} may not access payment {} of {}",
                    caller.userId(), payment.getPaymentNumber(), payment.getOwnerUserId());
        }
    }

    /**
     * Reading is wider than moving money: SUPPORT may open any payment, but only the
     * owner or an ADMIN may refund one.
     *
     * <p>This is the rule the admin panel shows its users — SUPPORT sees the panel in
     * read-only mode — and a UI-only rule is not a rule: without this check a support
     * token could still move money with a single curl. The owner keeps the right to
     * refund their own payment, which is what makes the rider client work.
     */
    static void requireRefundAuthority(AuthenticatedUser caller, Payment payment) {
        require(caller, payment);
        boolean owner = caller.userId().equals(payment.getOwnerUserId());
        if (!owner && !caller.isAdmin()) {
            throw DomainException.forbidden("refund of payment {} requires ADMIN or its owner, caller {} is neither",
                    payment.getPaymentNumber(), caller.userId());
        }
    }
}
