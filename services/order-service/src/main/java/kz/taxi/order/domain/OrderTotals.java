package kz.taxi.order.domain;

import kz.taxi.common.core.error.Preconditions;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;

/**
 * The arithmetic of a checkout, in one place.
 *
 * <p>{@code total = subtotal + deliveryFee} is also a database CHECK constraint
 * ({@code ck_order_total}); this record exists so the number the service computes
 * and the number the database enforces can never drift apart. Money is carried as
 * {@link Money} so mixing currencies fails loudly instead of summing tenge and
 * dollars into one meaningless total.
 *
 * @param subtotal    sum of the cart lines, must be positive
 * @param deliveryFee the configured delivery fee, zero means free delivery
 * @param total       {@code subtotal + deliveryFee}
 */
public record OrderTotals(Money subtotal, Money deliveryFee, Money total) {

    public OrderTotals {
        Preconditions.check(subtotal != null && subtotal.isPositive(),
                CommonMarkers.TOTALS_ERROR, "order subtotal must be positive");
        Preconditions.check(deliveryFee != null && !deliveryFee.isNegative(),
                CommonMarkers.TOTALS_ERROR, "delivery fee must not be negative");
        Preconditions.check(total != null && total.equals(subtotal.plus(deliveryFee)),
                CommonMarkers.TOTALS_ERROR, "total must equal subtotal + delivery fee");
    }

    /** Builds totals from a subtotal and a minor-unit delivery fee in the same currency. */
    public static OrderTotals of(Money subtotal, long deliveryFeeMinor) {
        Money fee = Money.ofMinor(deliveryFeeMinor, subtotal.currency());
        return new OrderTotals(subtotal, fee, subtotal.plus(fee));
    }

    /**
     * Totals of a cart's lines plus the delivery fee.
     *
     * <p>The currency comes from the lines, so a cart holding two currencies fails
     * with {@code CurrencyMismatchException} instead of adding tenge to dollars. An
     * empty cart has no subtotal and is rejected here rather than producing a
     * meaningless zero order — the caller turns that into {@code CART_EMPTY}.
     */
    public static OrderTotals ofCartItems(java.util.List<CartItem> items, long deliveryFeeMinor) {
        Preconditions.check(items != null && !items.isEmpty(),
                OrderErrorCode.CART_EMPTY, "an empty cart has no total");
        Currency currency = items.get(0).getCurrency();
        Money subtotal = Money.zero(currency);
        for (CartItem item : items) {
            subtotal = subtotal.plus(item.lineTotal());
        }
        return of(subtotal, deliveryFeeMinor);
    }

    public Currency currency() {
        return subtotal.currency();
    }

    public long subtotalMinor() {
        return subtotal.minorUnits();
    }

    public long deliveryFeeMinor() {
        return deliveryFee.minorUnits();
    }

    public long totalMinor() {
        return total.minorUnits();
    }

    /** Kept private: the only error this record can raise is a broken invariant. */
    private static final class CommonMarkers {
        private static final kz.taxi.common.core.error.ErrorCode TOTALS_ERROR =
                kz.taxi.common.core.error.CommonErrorCode.VALIDATION_FAILED;

        private CommonMarkers() {
        }
    }
}
