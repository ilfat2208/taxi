package kz.taxi.catalog.domain;

import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The arithmetic the whole marketplace depends on: what is sellable, and what each
 * stock movement does to the two counters.
 *
 * <p>These are invariants, not getters: if any of them changes, checkout can
 * oversell or lose inventory.
 */
class StockAvailabilityTest {

    @Nested
    @DisplayName("available = on hand - reserved")
    class AvailabilityMath {

        @Test
        void subtractsReservedFromOnHand() {
            assertThat(new Availability(10, 4).available()).isEqualTo(6);
            assertThat(new Availability(7, 0).available()).isEqualTo(7);
            assertThat(new Availability(3, 3).available()).isZero();
        }

        @Test
        void refusesATripleThatCannotExistInTheDatabase() {
            assertThatThrownBy(() -> new Availability(1, 2))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("exceeds on hand");
            assertThatThrownBy(() -> new Availability(-1, 0))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> new Availability(5, -1))
                    .isInstanceOf(IllegalArgumentException.class);
        }

        @Test
        void reserveLowersAvailabilityWithoutTouchingOnHand() {
            Availability reserved = new Availability(10, 4).reserve(3);

            assertThat(reserved.onHand()).isEqualTo(10);
            assertThat(reserved.reserved()).isEqualTo(7);
            assertThat(reserved.available()).isEqualTo(3);
        }

        @Test
        void commitTakesGoodsOutOfStock() {
            Availability committed = new Availability(10, 4).commit(4);

            assertThat(committed.onHand()).isEqualTo(6);
            assertThat(committed.reserved()).isZero();
            assertThat(committed.available()).isEqualTo(6);
        }

        @Test
        void releaseReturnsOnlyThePromise() {
            Availability released = new Availability(10, 4).release(4);

            assertThat(released.onHand()).isEqualTo(10);
            assertThat(released.reserved()).isZero();
            assertThat(released.available()).isEqualTo(10);
        }

        @Test
        void adjustMovesOnHandAndKeepsReserved() {
            assertThat(new Availability(10, 4).adjust(5).available()).isEqualTo(11);
            assertThat(new Availability(10, 4).adjust(-5).available()).isEqualTo(1);
        }

        @Test
        void canFulfilRequiresAPositiveQuantityThatFits() {
            Availability availability = new Availability(5, 3);

            assertThat(availability.canFulfil(2)).isTrue();
            assertThat(availability.canFulfil(3)).isFalse();
            assertThat(availability.canFulfil(0)).isFalse();
            assertThat(availability.canFulfil(-1)).isFalse();
        }
    }

    @Nested
    @DisplayName("stock counters")
    class StockCounters {

        @Test
        void newStockStartsFullyAvailable() {
            Stock stock = Stock.withOnHand("01J8ZCQ7Y4R3F0N5G8K2M9QW1T", 8);

            assertThat(stock.getOnHand()).isEqualTo(8);
            assertThat(stock.getReserved()).isZero();
            assertThat(stock.available()).isEqualTo(8);
            assertThat(stock.availability()).isEqualTo(new Availability(8, 0));
        }

        @Test
        void reserveHoldsStockAndShrinksAvailability() {
            Stock stock = Stock.withOnHand("P1", 5);

            stock.reserve(2);

            assertThat(stock.getReserved()).isEqualTo(2);
            assertThat(stock.getOnHand()).isEqualTo(5);
            assertThat(stock.available()).isEqualTo(3);
        }

        @Test
        void oversellingIsRejectedWithAConflictCode() {
            Stock stock = Stock.withOnHand("P1", 1);
            stock.reserve(1);

            assertThatThrownBy(() -> stock.reserve(1))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.INSUFFICIENT_STOCK);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
                        assertThat(failure.details()).containsEntry("available", 0)
                                .containsEntry("requested", 1)
                                .containsEntry("productId", "P1");
                    });
            assertThat(stock.getReserved()).isEqualTo(1);
        }

        @Test
        void commitDropsBothCounters() {
            Stock stock = Stock.withOnHand("P1", 5);
            stock.reserve(3);

            stock.commit(3);

            assertThat(stock.getOnHand()).isEqualTo(2);
            assertThat(stock.getReserved()).isZero();
            assertThat(stock.available()).isEqualTo(2);
        }

        @Test
        void releaseDropsOnlyReserved() {
            Stock stock = Stock.withOnHand("P1", 5);
            stock.reserve(3);

            stock.release(3);

            assertThat(stock.getOnHand()).isEqualTo(5);
            assertThat(stock.getReserved()).isZero();
            assertThat(stock.available()).isEqualTo(5);
        }

        @Test
        void commitCannotTakeMoreThanIsReserved() {
            Stock stock = Stock.withOnHand("P1", 5);

            assertThatThrownBy(() -> stock.commit(1))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.RESERVATION_NOT_ACTIVE));
            assertThat(stock.getOnHand()).isEqualTo(5);
        }

        @Test
        void adjustmentBelowReservedIsRejected() {
            Stock stock = Stock.withOnHand("P1", 10);
            stock.reserve(6);

            assertThatThrownBy(() -> stock.adjust(-5))
                    .isInstanceOfSatisfying(DomainException.class, failure -> {
                        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID);
                        assertThat(failure.errorCode().httpStatus()).isEqualTo(422);
                        assertThat(failure.details()).containsEntry("onHand", 10)
                                .containsEntry("reserved", 6)
                                .containsEntry("stockDelta", -5);
                    });
            assertThat(stock.getOnHand()).isEqualTo(10);
        }

        @Test
        void onHandCanNeverGoNegative() {
            Stock stock = Stock.withOnHand("P1", 2);

            assertThatThrownBy(() -> stock.adjust(-3))
                    .isInstanceOfSatisfying(DomainException.class,
                            failure -> assertThat(failure.errorCode())
                                    .isEqualTo(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID));
            assertThat(stock.getOnHand()).isEqualTo(2);
        }

        @Test
        void restockingKeepsReservationsIntact() {
            Stock stock = Stock.withOnHand("P1", 4);
            stock.reserve(4);

            stock.adjust(10);

            assertThat(stock.getOnHand()).isEqualTo(14);
            assertThat(stock.getReserved()).isEqualTo(4);
            assertThat(stock.available()).isEqualTo(10);
        }

        @Test
        void adjustmentDownToExactlyReservedIsAllowed() {
            Stock stock = Stock.withOnHand("P1", 10);
            stock.reserve(6);

            stock.adjust(-4);

            assertThat(stock.getOnHand()).isEqualTo(6);
            assertThat(stock.available()).isZero();
        }
    }
}
