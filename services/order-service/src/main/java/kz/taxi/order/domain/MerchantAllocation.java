package kz.taxi.order.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * How an order's money is divided between the merchants that fulfilled it.
 *
 * <p>One payment per merchant, because the payment contract and the settlement
 * ledger are both per merchant: money owed to two sellers cannot travel as one
 * payment without one of them losing theirs. This record is the arithmetic of that
 * split, kept next to {@link OrderTotals} so the sum a customer is charged and the
 * sum of the payments can never drift apart.
 *
 * <p><b>Where the delivery fee goes.</b> Delivery is one service, performed once
 * for the whole order, so its fee is charged once: it travels with the merchant
 * whose share is the largest (ties go to the lower merchant id, so the split is
 * reproducible). Splitting it pro rata would need an allocation rule nobody agreed
 * to and would leave a rounding residue that has to be dumped on somebody anyway;
 * charging it once keeps {@code sum(amounts) == order.total} exactly, with no
 * remainder to explain. It also keeps a single-merchant basket charging exactly
 * what it charged before split payments existed: that merchant already carried the
 * delivery fee inside the order total.
 *
 * @param merchantId          the seller this payment is addressed to
 * @param amountMinor         what this merchant is charged: their lines, plus the
 *                            delivery fee when {@code carriesDeliveryFee} is true
 * @param carriesDeliveryFee  true for the one merchant that carries the delivery fee
 */
public record MerchantAllocation(String merchantId, long amountMinor, boolean carriesDeliveryFee) {

    public MerchantAllocation {
        if (merchantId == null || merchantId.isBlank()) {
            throw new IllegalArgumentException("a payment must be addressed to a merchant");
        }
        if (amountMinor <= 0) {
            throw new IllegalArgumentException("a merchant payment must be for a positive amount");
        }
    }

    /**
     * The payments an order needs: one per merchant, in ascending merchant id order.
     *
     * <p>The order of the list is the order the saga charges them in, and it is
     * deliberately stable: a resumed checkout must charge the same merchants in the
     * same sequence, or a partly completed saga would be explained differently on
     * every recovery pass. Nothing about a wallet's ordering (which is what a
     * {@code HashMap} would give) belongs in a money path.
     *
     * @param items            the order's lines, already frozen at checkout prices
     * @param deliveryFeeMinor the order's delivery fee, charged to one merchant only
     */
    public static List<MerchantAllocation> split(List<OrderItem> items, long deliveryFeeMinor) {
        if (items == null || items.isEmpty()) {
            throw new IllegalArgumentException("an order without items cannot be paid");
        }
        if (deliveryFeeMinor < 0) {
            throw new IllegalArgumentException("a delivery fee cannot be negative");
        }

        Map<String, Long> byMerchant = new LinkedHashMap<>();
        for (OrderItem item : items) {
            byMerchant.merge(item.getMerchantId(), item.getLineTotalMinor(), Long::sum);
        }
        if (byMerchant.isEmpty()) {
            throw new IllegalArgumentException("an order without items cannot be paid");
        }

        // Ascending merchant id first, so the tie-break below is the same on every run.
        List<Map.Entry<String, Long>> shares = new ArrayList<>(byMerchant.entrySet());
        shares.sort(Map.Entry.comparingByKey());
        Map.Entry<String, Long> largest = shares.get(0);
        for (Map.Entry<String, Long> share : shares) {
            // Strictly greater, so a tie stays with the lower merchant id rather than
            // with whichever entry the iteration happens to reach last.
            if (share.getValue() > largest.getValue()) {
                largest = share;
            }
        }
        String carrier = largest.getKey();

        List<MerchantAllocation> allocations = new ArrayList<>(shares.size());
        for (Map.Entry<String, Long> share : shares) {
            boolean carries = share.getKey().equals(carrier);
            long amount = carries ? Math.addExact(share.getValue(), deliveryFeeMinor) : share.getValue();
            allocations.add(new MerchantAllocation(share.getKey(), amount, carries));
        }
        return List.copyOf(allocations);
    }

    /** The sum of the amounts: exactly the order total the customer agreed to. */
    public static long totalOf(List<MerchantAllocation> allocations) {
        return allocations.stream().mapToLong(MerchantAllocation::amountMinor).sum();
    }
}
