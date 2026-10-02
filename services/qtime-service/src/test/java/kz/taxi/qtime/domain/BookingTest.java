package kz.taxi.qtime.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.qtime.QtimeFixtures;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The booking aggregate.
 *
 * <p>What is worth asserting here is not that fields get copied, but the two promises the
 * aggregate makes: the price and the duration are a snapshot of what the client agreed to,
 * and a finished visit cannot be un-finished — the CRM's "неявки" and the client's receipt
 * both depend on those being true regardless of who calls the methods.
 */
class BookingTest {

    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);

    @Test
    @DisplayName("a new booking is CONFIRMED and occupies its window")
    void confirm_takes_the_window() {
        ServiceItem service = QtimeFixtures.service(company, 90, 450_000L);

        Booking booking = QtimeFixtures.booking(company, specialist, service,
                QtimeFixtures.at(LocalTime.of(15, 30)), "U-1");

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(booking.occupiesSlot()).isTrue();
        assertThat(booking.getStartsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(15, 30)));
        // 90 minutes of manicure, not a half-hour cell: the end follows from the service.
        assertThat(booking.getEndsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(17, 0)));
        assertThat(booking.getClientUserId()).isEqualTo("U-1");
        assertThat(booking.belongsTo("U-1")).isTrue();
        assertThat(booking.belongsTo("U-2")).isFalse();
    }

    @Test
    @DisplayName("the price and the duration are snapshots, not references")
    void confirm_snapshots_price_and_duration() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.booking(company, specialist, service,
                QtimeFixtures.at(LocalTime.of(10, 0)), "U-1");

        // Re-pricing the offer must not rewrite what this client was quoted.
        service.reprice(Money.ofMinor(700_000L, Currency.KZT), QtimeFixtures.NOW.plusSeconds(60));
        service.retime(120, QtimeFixtures.NOW.plusSeconds(60));

        assertThat(booking.getPriceMinor()).isEqualTo(600_000L);
        assertThat(booking.getDurationMinutes()).isEqualTo(60);
        assertThat(booking.price()).isEqualTo(Money.ofMinor(600_000L, Currency.KZT));
        assertThat(booking.price().currency()).isEqualTo(Currency.KZT);
    }

    @Test
    @DisplayName("every booking gets a readable QT- code, and two bookings never share one")
    void confirm_issues_a_code() {
        ServiceItem service = QtimeFixtures.service(company, 30, 250_000L);

        Booking first = QtimeFixtures.booking(company, specialist, service,
                QtimeFixtures.at(LocalTime.of(10, 0)), "U-1");
        Booking second = QtimeFixtures.booking(company, specialist, service,
                QtimeFixtures.at(LocalTime.of(10, 30)), "U-1");

        assertThat(first.getCode()).startsWith("QT-").hasSize(11);
        assertThat(BookingCode.isValid(first.getCode())).isTrue();
        assertThat(second.getCode()).isNotEqualTo(first.getCode());
        assertThat(BookingCode.isValid("QT-ОШИБКА")).isFalse();
    }

    @Test
    @DisplayName("a service another master performs cannot be booked")
    void confirm_refuses_a_foreign_service() {
        Specialist other = Specialist.register(company.getId(), "Динара", "мастер ресниц", 48_000, 4,
                QtimeFixtures.NOW);
        ServiceItem personal = QtimeFixtures.personalService(company, other, 120, 1_200_000L);

        assertThatThrownBy(() -> QtimeFixtures.booking(company, specialist, personal,
                QtimeFixtures.at(LocalTime.of(11, 0)), "U-1"))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST);
                    assertThat(ex.details()).containsEntry("specialistId", specialist.getId());
                });
    }

    @Test
    @DisplayName("a master of another company cannot be booked for this offer")
    void confirm_refuses_a_specialist_of_another_company() {
        Company otherCompany = Company.register("Барбершоп", CompanyCategory.BARBERSHOP, "Шымкент",
                "пр. Республики, 12", 42.3120, 69.5820, QtimeFixtures.ZONE.getId(), QtimeFixtures.NOW);
        Specialist foreign = QtimeFixtures.specialist(otherCompany);
        ServiceItem service = QtimeFixtures.service(company, 45, 400_000L);

        // The pair is incoherent: this master does not work for the company that sells the
        // service, so the request itself is wrong (400) rather than the calendar being busy.
        assertThatThrownBy(() -> QtimeFixtures.booking(company, foreign, service,
                QtimeFixtures.at(LocalTime.of(11, 0)), "U-1"))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.INVALID_BOOKING));
    }

    @Test
    @DisplayName("a booking without an owner is refused")
    void confirm_requires_an_owner() {
        ServiceItem service = QtimeFixtures.service(company, 30, 250_000L);

        assertThatThrownBy(() -> QtimeFixtures.booking(company, specialist, service,
                QtimeFixtures.at(LocalTime.of(10, 0)), " "))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.INVALID_BOOKING));
    }

    @Test
    @DisplayName("a client's cancellation frees the window and keeps the reason")
    void cancel_by_client() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));
        Instant cancelledAt = QtimeFixtures.at(LocalTime.of(10, 0));

        booking.cancel("заболел", false, cancelledAt);

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED_BY_CLIENT);
        assertThat(booking.getCancelReason()).isEqualTo("заболел");
        assertThat(booking.getCancelledAt()).isEqualTo(cancelledAt);
        // The slot is free again: only CONFIRMED occupies a window, which is exactly why
        // the unique index in the schema is partial.
        assertThat(booking.occupiesSlot()).isFalse();
        assertThat(booking.getStatus().isCancelled()).isTrue();
    }

    @Test
    @DisplayName("a company-side cancellation is a different fact from a client's")
    void cancel_by_company() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));

        booking.cancel("мастер заболел", true, QtimeFixtures.at(LocalTime.of(12, 0)));

        // "Клиент передумал" and "салон закрылся" are different numbers in a CRM, so the
        // distinction lives in the status and not in a free-text reason.
        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CANCELLED_BY_COMPANY);
    }

    @Test
    @DisplayName("a completed visit cannot be cancelled — the client did come")
    void completed_booking_cannot_be_cancelled() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));
        booking.complete(QtimeFixtures.at(LocalTime.of(16, 0)));

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.COMPLETED);

        assertThatThrownBy(() -> booking.cancel("передумал", false, QtimeFixtures.at(LocalTime.of(17, 0))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_NOT_CANCELLABLE);
                    assertThat(ex.details()).containsEntry("status", "COMPLETED");
                });
    }

    @Test
    @DisplayName("completing twice is a conflict, not a silent no-op on the aggregate")
    void complete_refuses_a_second_transition() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));
        booking.complete(QtimeFixtures.at(LocalTime.of(16, 0)));

        assertThatThrownBy(() -> booking.complete(QtimeFixtures.at(LocalTime.of(17, 0))))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_NOT_COMPLETABLE));
    }

    @Test
    @DisplayName("a no-show is terminal: it cannot be cancelled and cannot be erased")
    void no_show_is_terminal() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));

        booking.markNoShow(QtimeFixtures.at(LocalTime.of(16, 0)));

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.NO_SHOW);
        assertThat(booking.occupiesSlot()).isFalse();
        assertThatThrownBy(() -> booking.cancel("ой", false, QtimeFixtures.at(LocalTime.of(17, 0))))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_NOT_CANCELLABLE));
    }

    @Test
    @DisplayName("overlap is computed on half-open intervals: back-to-back is not a clash")
    void overlap_is_half_open() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking first = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));

        // 15:00-16:00 against 16:00-17:00: touching, not overlapping.
        assertThat(first.overlaps(QtimeFixtures.at(LocalTime.of(16, 0)),
                QtimeFixtures.at(LocalTime.of(17, 0)))).isFalse();
        assertThat(first.blocks(QtimeFixtures.at(LocalTime.of(16, 0)),
                QtimeFixtures.at(LocalTime.of(17, 0)))).isFalse();
        // 14:30-15:30 does overlap the first minute of the booking.
        assertThat(first.blocks(QtimeFixtures.at(LocalTime.of(14, 30)),
                QtimeFixtures.at(LocalTime.of(15, 30)))).isTrue();
        assertThat(first.getEndsAt()).isEqualTo(first.getStartsAt().plus(Duration.ofMinutes(60)));
    }

    @Test
    @DisplayName("a cancelled booking no longer blocks its window")
    void cancelled_booking_does_not_block() {
        ServiceItem service = QtimeFixtures.service(company, 60, 600_000L);
        Booking booking = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));

        assertThat(booking.blocks(booking.getStartsAt(), booking.getEndsAt())).isTrue();

        booking.cancel(null, false, QtimeFixtures.at(LocalTime.of(10, 0)));

        assertThat(booking.blocks(booking.getStartsAt(), booking.getEndsAt())).isFalse();
        // A cancellation without a reason is allowed: the fact matters, the excuse less so.
        assertThat(booking.getCancelReason()).isNull();
    }
}
