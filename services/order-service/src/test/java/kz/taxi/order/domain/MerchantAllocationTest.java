package kz.taxi.order.domain;

import kz.taxi.common.core.money.Currency;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The arithmetic of splitting an order between its merchants.
 *
 * <p>These are the numbers a customer is charged and a seller is paid, so the tests
 * are about totals and placement rather than about shape: the amounts must add up to
 * the order total (no lost tyyń, no invented one), the delivery fee must be charged
 * exactly once, and the order of the charges must be reproducible.
 */
class MerchantAllocationTest {

    private static final String ORDER_ID = "order-1";
    private static final String MERCHANT_1 = "merchant-1";
    private static final String MERCHANT_2 = "merchant-2";
    private static final String MERCHANT_3 = "merchant-3";

    @Test
    @DisplayName("a multi-merchant order is split by merchant, in ascending merchant id order")
    void splitsByMerchant() {
        List<MerchantAllocation> allocations = MerchantAllocation.split(List.of(
                item(MERCHANT_2, 7_000L, 1),
                item(MERCHANT_1, 5_000L, 2),
                item(MERCHANT_1, 1_000L, 3)), 0L);

        assertThat(allocations).extracting(MerchantAllocation::merchantId)
                .containsExactly(MERCHANT_1, MERCHANT_2);
        assertThat(allocations).extracting(MerchantAllocation::amountMinor)
                .containsExactly(13_000L, 7_000L);
        assertThat(MerchantAllocation.totalOf(allocations)).isEqualTo(20_000L);
    }

    @Test
    @DisplayName("the whole delivery fee is charged once, to the merchant with the largest share")
    void deliveryFeeGoesToTheLargestShare() {
        List<MerchantAllocation> allocations = MerchantAllocation.split(List.of(
                item(MERCHANT_1, 5_000L, 1),
                item(MERCHANT_2, 9_000L, 1),
                item(MERCHANT_3, 2_000L, 1)), 990L);

        assertThat(allocations).filteredOn(MerchantAllocation::carriesDeliveryFee)
                .singleElement()
                .satisfies(allocation -> {
                    assertThat(allocation.merchantId()).isEqualTo(MERCHANT_2);
                    assertThat(allocation.amountMinor()).isEqualTo(9_990L);
                });
        assertThat(allocations).extracting(MerchantAllocation::amountMinor)
                .containsExactly(5_000L, 9_990L, 2_000L);
        // The split adds up to the order total exactly: nothing is lost to rounding and
        // nothing has to be made up.
        assertThat(MerchantAllocation.totalOf(allocations)).isEqualTo(16_990L);
    }

    @Test
    @DisplayName("a tie goes to the lower merchant id, so the split is reproducible")
    void tiesGoToTheLowerMerchantId() {
        // 4_000 x 2 and 8_000 x 1 are the same share, deliberately.
        List<MerchantAllocation> allocations = MerchantAllocation.split(List.of(
                item(MERCHANT_2, 8_000L, 1),
                item(MERCHANT_1, 4_000L, 2)), 500L);

        assertThat(allocations).filteredOn(MerchantAllocation::carriesDeliveryFee)
                .singleElement()
                .satisfies(allocation -> assertThat(allocation.merchantId()).isEqualTo(MERCHANT_1));
        assertThat(MerchantAllocation.totalOf(allocations)).isEqualTo(16_500L);
    }

    @Test
    @DisplayName("a single-merchant order is charged its whole total, delivery fee included")
    void singleMerchantCarriesEverything() {
        List<MerchantAllocation> allocations = MerchantAllocation.split(
                List.of(item(MERCHANT_1, 5_000L, 2)), 990L);

        assertThat(allocations).singleElement().satisfies(allocation -> {
            assertThat(allocation.merchantId()).isEqualTo(MERCHANT_1);
            assertThat(allocation.amountMinor()).isEqualTo(10_990L);
            assertThat(allocation.carriesDeliveryFee()).isTrue();
        });
    }

    @Test
    @DisplayName("free delivery changes nothing about the split")
    void freeDeliveryLeavesTheAmountsAlone() {
        List<MerchantAllocation> allocations = MerchantAllocation.split(List.of(
                item(MERCHANT_1, 5_000L, 1),
                item(MERCHANT_2, 5_000L, 2)), 0L);

        assertThat(allocations).extracting(MerchantAllocation::amountMinor)
                .containsExactly(5_000L, 10_000L);
        assertThat(MerchantAllocation.totalOf(allocations)).isEqualTo(15_000L);
    }

    @Test
    @DisplayName("an order without items and a negative delivery fee are both refused")
    void refusesNonsense() {
        assertThatThrownBy(() -> MerchantAllocation.split(List.of(), 0L))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MerchantAllocation.split(List.of(item(MERCHANT_1, 100L, 1)), -1L))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new MerchantAllocation(MERCHANT_1, 0L, false))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static OrderItem item(String merchantId, long unitPriceMinor, int quantity) {
        return OrderItem.of(ORDER_ID, "product-" + merchantId, merchantId, "Title", unitPriceMinor, quantity,
                Currency.KZT);
    }
}
