package kz.taxi.payment.support;

import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentFees;
import kz.taxi.payment.domain.PaymentIntent;
import kz.taxi.payment.domain.PaymentType;

import java.util.Set;

/**
 * Fixtures shared by the fast tests.
 *
 * <p>Built through the real domain factories on purpose: a test that constructs a
 * {@link Payment} through a back door would keep passing after the factory started
 * enforcing a new invariant, which is exactly the kind of test that lies.
 */
public final class TestPayments {

    public static final Currency KZT = Currency.KZT;

    private TestPayments() {
    }

    public static AuthenticatedUser customer(String userId) {
        return new AuthenticatedUser(userId, "+77001234567", "Aigerim", Set.of(Roles.CUSTOMER));
    }

    public static AuthenticatedUser admin(String userId) {
        return new AuthenticatedUser(userId, "+77000000000", "Operator", Set.of(Roles.ADMIN));
    }

    public static PaymentIntent intent(PaymentType type,
                                       String ownerUserId,
                                       String sourceAccountId,
                                       String targetAccountId,
                                       String merchantId,
                                       String orderId,
                                       String idempotencyKey) {
        return new PaymentIntent(type, ownerUserId, sourceAccountId, targetAccountId, merchantId, orderId,
                "test payment", idempotencyKey, "0".repeat(64), null);
    }

    public static PaymentFees.FeeBreakdown breakdown(long amountMinor, long feeMinor) {
        return new PaymentFees.FeeBreakdown(Money.ofMinor(amountMinor, KZT), Money.ofMinor(feeMinor, KZT),
                Money.ofMinor(amountMinor + feeMinor, KZT));
    }

    /** A transfer for {@code amountMinor} with no fee. */
    public static Payment p2p(String ownerUserId, String sourceAccountId, String targetAccountId, long amountMinor) {
        return Payment.initiate(
                intent(PaymentType.P2P_TRANSFER, ownerUserId, sourceAccountId, targetAccountId, null, null,
                        "key-" + Ulid.nextId()),
                breakdown(amountMinor, 0L));
    }

    /** A marketplace payment whose payer is debited {@code amountMinor + feeMinor}. */
    public static Payment merchant(String ownerUserId, String sourceAccountId, String orderId,
                                   long amountMinor, long feeMinor) {
        return Payment.initiate(
                intent(PaymentType.MERCHANT_PAYMENT, ownerUserId, sourceAccountId, null, "MERCHANT-1", orderId,
                        "key-" + Ulid.nextId()),
                breakdown(amountMinor, feeMinor));
    }

    // ------------------------------------------------------------------ states

    public static Payment pending(Payment payment) {
        payment.markPending();
        return payment;
    }

    public static Payment holding(Payment payment, String holdId) {
        pending(payment);
        payment.recordHold(holdId);
        return payment;
    }

    public static Payment capturing(Payment payment, String holdId) {
        holding(payment, holdId);
        payment.beginCapture(holdId);
        return payment;
    }

    public static Payment releasing(Payment payment, String holdId) {
        holding(payment, holdId);
        payment.beginRelease(holdId, "test compensation");
        return payment;
    }

    public static Payment completed(Payment payment) {
        pending(payment);
        payment.markCompleted();
        return payment;
    }

    public static final String HOLD_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1T";
}
