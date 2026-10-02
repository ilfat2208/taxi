package kz.taxi.catalog.domain;

/**
 * The stock triple every read model needs: what is physically there, what is
 * already promised, and what is therefore still sellable.
 *
 * <p>{@code available = onHand - reserved} is the only number a marketplace may
 * sell from. Keeping the arithmetic in one immutable value object (instead of
 * repeating {@code onHand - reserved} in mappers, endpoints and tests) is what
 * stops "sellable" from drifting between the catalog page, the checkout and the
 * merchant dashboard.
 *
 * <p>The compact constructor encodes the database invariant
 * {@code ck_stock_reserved_le_on_hand}, so an impossible triple cannot even be
 * constructed in memory.
 */
public record Availability(int onHand, int reserved) {

    public Availability {
        if (onHand < 0) {
            throw new IllegalArgumentException("on hand must not be negative: " + onHand);
        }
        if (reserved < 0) {
            throw new IllegalArgumentException("reserved must not be negative: " + reserved);
        }
        if (reserved > onHand) {
            throw new IllegalArgumentException(
                    "reserved %d exceeds on hand %d".formatted(reserved, onHand));
        }
    }

    public static Availability empty() {
        return new Availability(0, 0);
    }

    public int available() {
        return onHand - reserved;
    }

    public boolean canFulfil(int quantity) {
        return quantity > 0 && available() >= quantity;
    }

    /** Holds {@code quantity} for a checkout: available drops, on hand does not. */
    public Availability reserve(int quantity) {
        requirePositive(quantity);
        return new Availability(onHand, reserved + quantity);
    }

    /** Paid: the goods leave the warehouse, so both numbers drop. */
    public Availability commit(int quantity) {
        requirePositive(quantity);
        return new Availability(onHand - quantity, reserved - quantity);
    }

    /** Abandoned/released: only the promise goes away. */
    public Availability release(int quantity) {
        requirePositive(quantity);
        return new Availability(onHand, reserved - quantity);
    }

    /** Merchant restock (positive) or shrinkage (negative). */
    public Availability adjust(int delta) {
        return new Availability(onHand + delta, reserved);
    }

    private static void requirePositive(int quantity) {
        if (quantity <= 0) {
            throw new IllegalArgumentException("quantity must be positive: " + quantity);
        }
    }
}
