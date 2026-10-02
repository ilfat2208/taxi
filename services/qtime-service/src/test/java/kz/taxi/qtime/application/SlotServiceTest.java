package kz.taxi.qtime.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.qtime.QtimeFixtures;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.BookingStatus;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ScheduleException;
import kz.taxi.qtime.domain.ScheduleExceptionKind;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Slot;
import kz.taxi.qtime.domain.SlotGrid;
import kz.taxi.qtime.domain.SlotUnavailability;
import kz.taxi.qtime.domain.Specialist;
import kz.taxi.qtime.domain.WorkingHours;
import kz.taxi.qtime.infrastructure.BookingRepository;
import kz.taxi.qtime.infrastructure.CompanyRepository;
import kz.taxi.qtime.infrastructure.QtimeProperties;
import kz.taxi.qtime.infrastructure.ScheduleExceptionRepository;
import kz.taxi.qtime.infrastructure.ServiceItemRepository;
import kz.taxi.qtime.infrastructure.SpecialistRepository;
import kz.taxi.qtime.infrastructure.WorkingHoursRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * The slot arithmetic: the part of QTime a client is actually promised.
 *
 * <p>Every test here is a promise somebody makes to a customer: a grid a person can
 * book from, a lunch a 90-minute manicure does not fit into, a window that disappears
 * the moment somebody else takes it, and a day off that publishes no windows at all.
 * The clock is fixed — "свободно ли 15:30" is a question about the lead time and the
 * horizon at the same moment, and a test that cannot move that moment cannot check
 * either without sleeping.
 */
@ExtendWith(MockitoExtension.class)
class SlotServiceTest {

    @Mock
    private CompanyRepository companies;

    @Mock
    private SpecialistRepository specialists;

    @Mock
    private ServiceItemRepository services;

    @Mock
    private WorkingHoursRepository workingHours;

    @Mock
    private ScheduleExceptionRepository exceptions;

    @Mock
    private BookingRepository bookings;

    private final QtimeProperties properties = new QtimeProperties();
    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);

    @BeforeEach
    void wireLookups() {
        // Lenient: a test that refuses a request before it reaches a lookup must not fail
        // on an unused stub — the wiring is shared, the paths through it are not.
        lenient().when(specialists.findById(specialist.getId())).thenReturn(Optional.of(specialist));
        lenient().when(companies.findById(company.getId())).thenReturn(Optional.of(company));
    }

    /** The service with the clock stopped at a local time on the fixture date. */
    private SlotService serviceAt(LocalTime localTime) {
        return serviceAt(QtimeFixtures.at(localTime));
    }

    private SlotService serviceAt(java.time.Instant now) {
        return new SlotService(companies, specialists, services, workingHours, exceptions, bookings,
                properties, Clock.fixed(now, ZoneOffset.UTC));
    }

    private ServiceItem offer(int durationMinutes, long priceMinor) {
        ServiceItem service = QtimeFixtures.service(company, durationMinutes, priceMinor);
        // Lenient: some tests refuse the request before the service is ever looked up.
        lenient().when(services.findById(service.getId())).thenReturn(Optional.of(service));
        return service;
    }

    /** Пн-сб 09:00-20:00, обед 13:00-14:00 — for every weekday, so a test can pick its date. */
    private void worksWeekdays(WorkingHours... rules) {
        lenient().when(workingHours.findBySpecialistIdAndDayOfWeek(eq(specialist.getId()), any(DayOfWeek.class)))
                .thenReturn(List.of(rules));
    }

    private static Slot cellAt(SlotGrid grid, LocalTime localTime) {
        return cellOn(grid, QtimeFixtures.DATE, localTime);
    }

    private static Slot cellOn(SlotGrid grid, LocalDate date, LocalTime localTime) {
        return grid.slots().stream()
                .filter(slot -> slot.startsAt().equals(QtimeFixtures.at(date, localTime)))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no cell at " + localTime + " in " + grid.slots()));
    }

    // ------------------------------------------------------------------ the grid

    @Test
    @DisplayName("the grid walks the shift in steps, from the opening to the last start that fits")
    void grid_steps_through_the_shift() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem service = offer(30, 250_000L);

        // The clock is before opening time, so the lead time does not cut the first cells
        // off and the whole shift is visible.
        SlotGrid grid = serviceAt(LocalTime.of(7, 0)).slots(specialist.getId(), service.getId(),
                QtimeFixtures.DATE);

        // 09:00..19:30 in half hours: 22 cells, each 30 minutes long, in order.
        assertThat(grid.slots()).hasSize(22);
        assertThat(grid.slots().get(0).startsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(9, 0)));
        assertThat(grid.slots().get(21).startsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(19, 30)));
        assertThat(grid.durationMinutes()).isEqualTo(30);
        assertThat(grid.timeZone()).isEqualTo("Asia/Almaty");
        assertThat(grid.date()).isEqualTo(QtimeFixtures.DATE);
        assertThat(grid.slots()).allSatisfy(slot ->
                assertThat(slot.endsAt()).isEqualTo(slot.startsAt().plus(Duration.ofMinutes(30))));
        assertThat(grid.slots()).allSatisfy(slot -> assertThat(slot.available()).isTrue());
        assertThat(grid.availableCount()).isEqualTo(22);
    }

    @Test
    @DisplayName("the lunch break is not offered, but its edges are usable")
    void lunch_is_excluded() {
        worksWeekdays(QtimeFixtures.workingDay(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem service = offer(60, 600_000L);

        SlotGrid grid = serviceAt(LocalTime.of(9, 0)).slots(specialist.getId(), service.getId(),
                QtimeFixtures.DATE);

        // 12:00-13:00 ends exactly when the break starts: half-open intervals, so it fits.
        assertThat(cellAt(grid, LocalTime.of(12, 0)).available()).isTrue();
        // 13:00 is inside the break.
        assertThat(cellAt(grid, LocalTime.of(13, 0)).available()).isFalse();
        assertThat(cellAt(grid, LocalTime.of(13, 0)).reason()).isEqualTo(SlotUnavailability.BREAK);
        assertThat(cellAt(grid, LocalTime.of(13, 30)).reason()).isEqualTo(SlotUnavailability.BREAK);
        // 14:00 starts exactly when the break ends.
        assertThat(cellAt(grid, LocalTime.of(14, 0)).available()).isTrue();
    }

    @Test
    @DisplayName("a 90-minute service does not fit in the 30 minutes before lunch")
    void long_service_does_not_fit_before_lunch() {
        worksWeekdays(QtimeFixtures.workingDay(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem manicure = offer(90, 450_000L);

        SlotGrid grid = serviceAt(LocalTime.of(9, 0)).slots(specialist.getId(), manicure.getId(),
                QtimeFixtures.DATE);

        // The whole point of computing on intervals rather than on start times: 12:30 is a
        // perfectly valid grid cell, and unusable for this service.
        Slot beforeLunch = cellAt(grid, LocalTime.of(12, 30));
        assertThat(beforeLunch.available()).isFalse();
        assertThat(beforeLunch.reason()).isEqualTo(SlotUnavailability.BREAK);
        assertThat(beforeLunch.endsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(14, 0)));
        // 12:00 with 90 minutes runs to 13:30, i.e. into the break as well.
        assertThat(cellAt(grid, LocalTime.of(12, 0)).reason()).isEqualTo(SlotUnavailability.BREAK);
        // 11:30-13:00 ends exactly at the break: usable.
        assertThat(cellAt(grid, LocalTime.of(11, 30)).available()).isTrue();
        // The same service after lunch is fine.
        assertThat(cellAt(grid, LocalTime.of(14, 0)).available()).isTrue();
    }

    @Test
    @DisplayName("a service that would run past closing time says so")
    void service_does_not_fit_before_closing() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem manicure = offer(90, 450_000L);

        SlotGrid grid = serviceAt(LocalTime.of(9, 0)).slots(specialist.getId(), manicure.getId(),
                QtimeFixtures.DATE);

        // 18:30 + 90 minutes = 20:00, exactly the end of the shift: usable.
        assertThat(cellAt(grid, LocalTime.of(18, 30)).available()).isTrue();
        // 19:00 + 90 minutes = 20:30, past closing time: the day simply has no room.
        assertThat(cellAt(grid, LocalTime.of(19, 0)).available()).isFalse();
        assertThat(cellAt(grid, LocalTime.of(19, 0)).reason()).isEqualTo(SlotUnavailability.NOT_ENOUGH_TIME);
    }

    // ------------------------------------------------------------------ occupied windows

    @Test
    @DisplayName("an occupied window stays in the grid, marked 'занято'")
    void occupied_windows_are_returned_as_unavailable() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem service = offer(60, 600_000L);
        Booking taken = QtimeFixtures.bookingAt(company, specialist, service, LocalTime.of(15, 0));
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED),
                any(), any())).thenReturn(List.of(taken));

        SlotGrid grid = serviceAt(LocalTime.of(9, 0)).slots(specialist.getId(), service.getId(),
                QtimeFixtures.DATE);

        // The screen shows the whole day: a client who sees 15:00 crossed out picks 16:00,
        // while a grid that silently skipped it would look broken.
        assertThat(cellAt(grid, LocalTime.of(15, 0)).available()).isFalse();
        assertThat(cellAt(grid, LocalTime.of(15, 0)).reason()).isEqualTo(SlotUnavailability.BUSY);
        assertThat(cellAt(grid, LocalTime.of(14, 30)).reason()).isEqualTo(SlotUnavailability.BUSY);
        assertThat(cellAt(grid, LocalTime.of(16, 0)).available()).isTrue();
    }

    @Test
    @DisplayName("a window is blocked by overlap, not by an identical start time")
    void overlapping_windows_are_blocked() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem thirty = offer(30, 250_000L);
        ServiceItem ninety = QtimeFixtures.service(company, 90, 450_000L);
        // Somebody took 15:00-16:30 with a long service.
        Booking taken = QtimeFixtures.bookingAt(company, specialist, ninety, LocalTime.of(15, 0));
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED),
                any(), any())).thenReturn(List.of(taken));

        SlotGrid grid = serviceAt(LocalTime.of(9, 0)).slots(specialist.getId(), thirty.getId(),
                QtimeFixtures.DATE);

        // 16:00-16:30 sits inside the 90-minute booking even though its start time is free.
        assertThat(cellAt(grid, LocalTime.of(16, 0)).reason()).isEqualTo(SlotUnavailability.BUSY);
        // 16:30 starts exactly when the booking ends.
        assertThat(cellAt(grid, LocalTime.of(16, 30)).available()).isTrue();
    }

    // ------------------------------------------------------------------ now and the horizon

    @Test
    @DisplayName("cells in the past, and closer than the lead time, are not offered at all")
    void past_cells_are_dropped() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem service = offer(30, 250_000L);

        SlotGrid grid = serviceAt(LocalTime.of(12, 0)).slots(specialist.getId(), service.getId(),
                QtimeFixtures.DATE);

        // Now is 12:00 and the lead time is 30 minutes, so the day starts at 12:30.
        assertThat(grid.slots().get(0).startsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(12, 30)));
        assertThat(grid.slots()).allSatisfy(slot ->
                assertThat(slot.startsAt()).isAfterOrEqualTo(QtimeFixtures.at(LocalTime.of(12, 30))));
        // The cell at 12:30 is exactly at the lead-time boundary and must be bookable.
        assertThat(cellAt(grid, LocalTime.of(12, 30)).available()).isTrue();
    }

    @Test
    @DisplayName("a start that is a second too soon is not offered")
    void lead_time_boundary_is_strict() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem service = offer(30, 250_000L);

        // 12:07 + 30 minutes = 12:37, so the first bookable cell is 13:00.
        SlotGrid grid = serviceAt(LocalTime.of(12, 7)).slots(specialist.getId(), service.getId(),
                QtimeFixtures.DATE);

        assertThat(grid.slots().get(0).startsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(13, 0)));
    }

    @Test
    @DisplayName("a past date is refused, not answered with an empty grid")
    void past_date_is_refused() {
        ServiceItem service = offer(30, 250_000L);

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0))
                .slots(specialist.getId(), service.getId(), QtimeFixtures.DATE.minusDays(1)))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_IN_PAST));
    }

    @Test
    @DisplayName("the booking horizon is enforced on the grid as well as on a booking")
    void horizon_is_enforced() {
        ServiceItem service = offer(30, 250_000L);

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0))
                .slots(specialist.getId(), service.getId(),
                        QtimeFixtures.DATE.plusDays(properties.effectiveBookingHorizonDays())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_BOOKING_HORIZON);
                    assertThat(ex.details()).containsKey("lastBookableDate");
                });
    }

    // ------------------------------------------------------------------ days off

    @Test
    @DisplayName("a day without a weekly rule is an empty grid, not an error")
    void day_off_publishes_nothing() {
        // Sunday: the demo city has no rule for it, and its absence IS the day off.
        LocalDate sunday = LocalDate.of(2026, 5, 17);
        when(workingHours.findBySpecialistIdAndDayOfWeek(specialist.getId(), DayOfWeek.SUNDAY))
                .thenReturn(List.of());
        ServiceItem service = offer(60, 600_000L);

        SlotGrid grid = serviceAt(QtimeFixtures.at(sunday, LocalTime.of(9, 0)))
                .slots(specialist.getId(), service.getId(), sunday);

        assertThat(grid.date()).isEqualTo(sunday);
        assertThat(grid.slots()).isEmpty();
        assertThat(grid.availableCount()).isZero();
    }

    @Test
    @DisplayName("a vacation removes the day even though the weekly rule says otherwise")
    void vacation_closes_the_day() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        ServiceItem service = offer(60, 600_000L);
        when(exceptions.findBySpecialistIdAndExceptionDate(specialist.getId(), QtimeFixtures.DATE))
                .thenReturn(Optional.of(ScheduleException.close(specialist.getId(), QtimeFixtures.DATE,
                        ScheduleExceptionKind.VACATION, "отпуск", QtimeFixtures.NOW)));

        SlotGrid grid = serviceAt(LocalTime.of(9, 0)).slots(specialist.getId(), service.getId(),
                QtimeFixtures.DATE);

        // An exception wins outright: intersecting it with the week would publish exactly
        // the windows the master is away for.
        assertThat(grid.slots()).isEmpty();
    }

    @Test
    @DisplayName("an extra shift adds windows on a day the week does not cover")
    void extra_shift_adds_a_window() {
        LocalDate saturday = LocalDate.of(2026, 5, 16);
        // No weekly rule for Saturday: the shop is normally closed, and the exception is
        // what opens it.
        when(exceptions.findBySpecialistIdAndExceptionDate(specialist.getId(), saturday))
                .thenReturn(Optional.of(ScheduleException.extraShift(specialist.getId(), saturday,
                        LocalTime.of(10, 0), LocalTime.of(13, 0), "субботняя смена", QtimeFixtures.NOW)));
        ServiceItem service = offer(60, 600_000L);

        SlotGrid grid = serviceAt(QtimeFixtures.at(saturday, LocalTime.of(9, 0)))
                .slots(specialist.getId(), service.getId(), saturday);

        assertThat(grid.slots()).hasSize(6);   // 10:00, 10:30 ... 12:30
        assertThat(grid.slots().get(0).startsAt())
                .isEqualTo(QtimeFixtures.at(saturday, LocalTime.of(10, 0)));
        // The shift somebody added ends at 13:00, so the last 60-minute cell does not fit.
        assertThat(grid.availableCount()).isEqualTo(5);
        assertThat(cellOn(grid, saturday, LocalTime.of(12, 30)).reason())
                .isEqualTo(SlotUnavailability.NOT_ENOUGH_TIME);
    }

    // ------------------------------------------------------------------ refusals

    @Test
    @DisplayName("a service this master does not perform has no grid")
    void foreign_service_is_refused() {
        Specialist other = Specialist.register(company.getId(), "Динара", "мастер ресниц", 48_000, 4,
                QtimeFixtures.NOW);
        ServiceItem personal = QtimeFixtures.personalService(company, other, 120, 1_200_000L);
        when(services.findById(personal.getId())).thenReturn(Optional.of(personal));

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0))
                .slots(specialist.getId(), personal.getId(), QtimeFixtures.DATE))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode())
                                .isEqualTo(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST));
    }

    @Test
    @DisplayName("an unknown specialist is a 404, not an empty grid")
    void unknown_specialist_is_not_found() {
        when(specialists.findById("01UNKNOWN")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0))
                .slots("01UNKNOWN", "01SERVICE", QtimeFixtures.DATE))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SPECIALIST_NOT_FOUND));
    }

    // ------------------------------------------------------------------ booking-time checks

    @Test
    @DisplayName("a booking inside the shift and clear of the break passes")
    void bookable_time_is_accepted() {
        worksWeekdays(QtimeFixtures.workingDay(specialist, QtimeFixtures.DATE.getDayOfWeek()));

        serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company, 90,
                QtimeFixtures.at(LocalTime.of(15, 0)));
        serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company, 90,
                QtimeFixtures.at(LocalTime.of(11, 30)));   // 11:30-13:00, ends at the break
    }

    @Test
    @DisplayName("a booking into the lunch break is refused with the same rule the grid used")
    void bookable_time_crossing_lunch_is_refused() {
        worksWeekdays(QtimeFixtures.workingDay(specialist, QtimeFixtures.DATE.getDayOfWeek()));

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company,
                90, QtimeFixtures.at(LocalTime.of(12, 30))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_WORKING_HOURS);
                    assertThat(ex.details()).containsEntry("reason", "BREAK");
                });
    }

    @Test
    @DisplayName("a booking before opening or after closing is refused")
    void bookable_time_outside_the_shift_is_refused() {
        worksWeekdays(QtimeFixtures.workingDay(specialist, QtimeFixtures.DATE.getDayOfWeek()));

        // Entirely before the salon opens: "you asked for a time we do not work".
        assertThatThrownBy(() -> serviceAt(LocalTime.of(5, 0)).requireWithinWorkingHours(specialist, company,
                60, QtimeFixtures.at(LocalTime.of(6, 0))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_WORKING_HOURS);
                    assertThat(ex.details()).containsEntry("reason", "OUTSIDE_SHIFT");
                });

        // Starts inside the shift and runs past closing time: the service does not fit.
        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company,
                90, QtimeFixtures.at(LocalTime.of(19, 30))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_WORKING_HOURS);
                    assertThat(ex.details()).containsEntry("reason", "CROSSES_SHIFT");
                });
    }

    @Test
    @DisplayName("a booking on a day off is refused, and says which reason it was")
    void bookable_time_on_a_day_off_is_refused() {
        when(workingHours.findBySpecialistIdAndDayOfWeek(eq(specialist.getId()), any(DayOfWeek.class)))
                .thenReturn(List.of());

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company,
                60, QtimeFixtures.at(LocalTime.of(10, 0))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_WORKING_HOURS);
                    assertThat(ex.details()).containsEntry("reason", "DAY_OFF");
                });
    }

    @Test
    @DisplayName("the past and the too-soon are told apart")
    void past_and_too_soon_are_different_codes() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));

        // Now is 09:00; 08:30 is behind us, 09:15 is in front of us but inside the lead time.
        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company,
                30, QtimeFixtures.at(LocalTime.of(8, 30))))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_IN_PAST));

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company,
                30, QtimeFixtures.at(LocalTime.of(9, 15))))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_TOO_SOON);
                    assertThat(ex.details()).containsEntry("minLeadTimeMinutes", 30);
                });
    }

    @Test
    @DisplayName("a booking beyond the horizon is refused")
    void bookable_time_beyond_the_horizon_is_refused() {
        worksWeekdays(QtimeFixtures.workingDayWithoutBreak(specialist, QtimeFixtures.DATE.getDayOfWeek()));
        LocalDate far = QtimeFixtures.DATE.plusDays(properties.effectiveBookingHorizonDays());

        assertThatThrownBy(() -> serviceAt(LocalTime.of(9, 0)).requireWithinWorkingHours(specialist, company,
                30, QtimeFixtures.at(far, LocalTime.of(10, 0))))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_BOOKING_HORIZON));
    }

    @Test
    @DisplayName("windows are looked up for the date in the company's own zone")
    void windows_are_resolved_in_the_company_zone() {
        when(workingHours.findBySpecialistIdAndDayOfWeek(anyString(), any(DayOfWeek.class)))
                .thenReturn(List.of(QtimeFixtures.workingDay(specialist, DayOfWeek.MONDAY)));

        List<WorkingWindow> monday = serviceAt(LocalTime.of(9, 0))
                .windowsFor(specialist, LocalDate.of(2026, 5, 18));

        assertThat(monday).hasSize(1);
        assertThat(monday.get(0).start()).isEqualTo(LocalTime.of(9, 0));
        assertThat(monday.get(0).end()).isEqualTo(LocalTime.of(20, 0));
        assertThat(monday.get(0).breakStart()).isEqualTo(LocalTime.of(13, 0));
    }
}
