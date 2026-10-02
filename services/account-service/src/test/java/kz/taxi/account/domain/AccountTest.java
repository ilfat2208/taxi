package kz.taxi.account.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The invariants of a wallet, tested without Spring, without a database and
 * without mocks: these rules are the reason nobody can spend money twice.
 */
class AccountTest {

    private Account wallet() {
        return Account.open("U-1", "+77001234567", "Aisha", AccountType.CUSTOMER, Currency.KZT);
    }

    private Account funded(long amountMinor) {
        Account account = wallet();
        account.credit(amountMinor, Currency.KZT);
        return account;
    }

    @Nested
    @DisplayName("reservation")
    class Reservation {

        @Test
        @DisplayName("holds reduce what is available but not the balance")
        void hold_reduces_available_only() {
            Account account = funded(100_000);

            account.reserve(30_000, Currency.KZT);

            assertThat(account.getBalanceMinor()).isEqualTo(100_000);
            assertThat(account.getHeldMinor()).isEqualTo(30_000);
            assertThat(account.availableMinor()).isEqualTo(70_000);
        }

        @Test
        @DisplayName("cannot reserve more than is available")
        void rejects_over_reservation() {
            Account account = funded(10_000);
            account.reserve(9_000, Currency.KZT);

            // The rejection explains itself in human units, not in minor units:
            // an operator reading a log should not have to divide by 100.
            assertThatThrownBy(() -> account.reserve(2_000, Currency.KZT))
                    .isInstanceOf(DomainException.class)
                    .hasMessageContaining("10.00 KZT");

            assertThat(account.availableMinor()).isEqualTo(1_000);
        }

        @Test
        @DisplayName("a second reservation cannot use funds already reserved")
        void reserved_funds_are_not_double_spent() {
            Account account = funded(50_000);

            account.reserve(50_000, Currency.KZT);

            assertThatThrownBy(() -> account.reserve(1, Currency.KZT))
                    .isInstanceOf(DomainException.class);
        }

        @Test
        @DisplayName("release makes the funds available again")
        void release_restores_availability() {
            Account account = funded(100_000);
            account.reserve(40_000, Currency.KZT);

            account.releaseReserved(40_000);

            assertThat(account.getHeldMinor()).isZero();
            assertThat(account.availableMinor()).isEqualTo(100_000);
        }

        @Test
        @DisplayName("releasing more than is reserved is rejected")
        void rejects_over_release() {
            Account account = funded(100_000);
            account.reserve(10_000, Currency.KZT);

            assertThatThrownBy(() -> account.releaseReserved(20_000))
                    .isInstanceOf(DomainException.class);
        }

        @Test
        @DisplayName("currency mismatches never touch the balance")
        void rejects_foreign_currency() {
            Account account = funded(100_000);

            assertThatThrownBy(() -> account.reserve(1_000, Currency.USD))
                    .isInstanceOf(DomainException.class)
                    .hasMessageContaining("KZT");

            assertThat(account.getHeldMinor()).isZero();
        }

        @Test
        @DisplayName("amounts must be positive")
        void rejects_non_positive_amounts() {
            Account account = funded(100_000);

            assertThatThrownBy(() -> account.reserve(0, Currency.KZT)).isInstanceOf(DomainException.class);
            assertThatThrownBy(() -> account.reserve(-5, Currency.KZT)).isInstanceOf(DomainException.class);
        }
    }

    @Nested
    @DisplayName("capture")
    class Capture {

        @Test
        @DisplayName("capturing reserved funds removes them from balance and from reserved")
        void capture_moves_reserved_money() {
            Account account = funded(100_000);
            account.reserve(25_000, Currency.KZT);

            account.debitReserved(25_000);

            assertThat(account.getBalanceMinor()).isEqualTo(75_000);
            assertThat(account.getHeldMinor()).isZero();
            assertThat(account.availableMinor()).isEqualTo(75_000);
        }

        @Test
        @DisplayName("capturing twice fails the second time: reserved funds are gone")
        void double_capture_is_impossible() {
            Account account = funded(100_000);
            account.reserve(25_000, Currency.KZT);
            account.debitReserved(25_000);

            assertThatThrownBy(() -> account.debitReserved(25_000))
                    .isInstanceOf(DomainException.class);

            assertThat(account.getBalanceMinor()).isEqualTo(75_000);
        }

        @Test
        @DisplayName("a frozen account refuses to move money")
        void frozen_account_is_inert() {
            Account account = funded(100_000);
            account.freeze();

            assertThatThrownBy(() -> account.reserve(1_000, Currency.KZT)).isInstanceOf(DomainException.class);
            assertThatThrownBy(() -> account.credit(1_000, Currency.KZT)).isInstanceOf(DomainException.class);
        }
    }

    @Nested
    @DisplayName("credits and debits")
    class Movement {

        @Test
        @DisplayName("credit increases balance and keeps reserved untouched")
        void credit_accumulates() {
            Account account = funded(10_000);
            account.reserve(4_000, Currency.KZT);

            account.credit(5_000, Currency.KZT);

            assertThat(account.getBalanceMinor()).isEqualTo(15_000);
            assertThat(account.getHeldMinor()).isEqualTo(4_000);
            assertThat(account.availableMinor()).isEqualTo(11_000);
        }

        @Test
        @DisplayName("a customer wallet can never go negative")
        void customer_wallet_never_negative() {
            Account account = funded(10_000);

            assertThatThrownBy(() -> AccountDebitSupport.debit(account, 20_000, Currency.KZT))
                    .isInstanceOf(DomainException.class);

            assertThat(account.getBalanceMinor()).isEqualTo(10_000);
        }

        @Test
        @DisplayName("the suspense account may go negative: it stands for the outside world")
        void suspense_account_may_be_negative() {
            Account suspense = Account.openSystemAccount(Currency.KZT);

            AccountDebitSupport.debit(suspense, 500_000, Currency.KZT);

            assertThat(suspense.getBalanceMinor()).isEqualTo(-500_000);
            assertThat(suspense.isSystem()).isTrue();
        }
    }

    @Nested
    @DisplayName("holds")
    class Holds {

        @Test
        @DisplayName("capture and release are terminal and idempotent")
        void lifecycle_is_terminal() {
            AccountHold hold = AccountHold.place("A-1", 1_000, Currency.KZT, "PAYMENT", "P-1", "key-1", "test", null);

            hold.capture();
            hold.capture();
            assertThat(hold.getStatus()).isEqualTo(HoldStatus.CAPTURED);
            assertThatThrownBy(hold::release).isInstanceOf(DomainException.class);
        }

        @Test
        @DisplayName("an expiration timestamp marks a hold as reclaimable")
        void detects_expiry() {
            AccountHold hold = AccountHold.place("A-1", 1_000, Currency.KZT, "PAYMENT", "P-1", "key-2", "test",
                    java.time.Instant.now().minusSeconds(1));

            assertThat(hold.isExpired(java.time.Instant.now())).isTrue();
            hold.expire();
            assertThat(hold.getStatus()).isEqualTo(HoldStatus.EXPIRED);
        }
    }
}
