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
}
