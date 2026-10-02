package kz.taxi.qtime.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.BookingStatus;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ScheduleException;
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
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Free windows: the calculation QTime exists for.
 *
 * <p>Свободные окна — вычисляемая величина, а не таблица, которую кто-то ведёт руками
 * ({@code docs/orta.md} §3). A window is:
 *
 * <pre>
 *   рабочее время специалиста на дату
 *     - перерыв
 *     - уже занятые записи (по интервалам, не по началу слота)
 *     - прошедшее время и min-lead-time
 * </pre>
 *
 * <p>Three decisions are worth stating out loud, because each of them is a promise to
 * a customer:
 *
 * <ol>
 *   <li><b>Overlap is computed on intervals, not on start times.</b> A 90-minute
 *       manicure at 12:30 runs into the 13:00 lunch and is refused, even though 12:30
 *       is a perfectly valid grid cell; a 30-minute haircut at 12:30 is fine. Anything
 *       less and the salon would overbook itself the first busy Saturday.</li>
 *   <li><b>Unavailable cells are returned, with a reason.</b> The phone shows the grid
 *       from the mockup — greyed-out cells and all — and "занято" tells a client to pick
 *       15:30 instead, while a silently shorter grid tells them the app is broken.</li>
 *   <li><b>Cells in the past, and cells closer than the lead time, are dropped rather
 *       than greyed out.</b> "Свободно было в 10:00" is not an answer to "когда можно
 *       прийти": a grid should start at the first time that can actually be booked.</li>
 * </ol>
 *
 * <p>The same rules are re-applied to a concrete {@code startsAt} by
 * {@link #requireWithinWorkingHours}, so the grid a client sees and the booking the
 * server accepts cannot drift apart: a client that posts a time it never saw is
 * refused with the same reasoning the grid used.
 */
@Service
@Slf4j
public class SlotService {

    /** A day is 24 hours; a window that would end past midnight is not a window we accept. */
    private static final int MINUTES_PER_DAY = 24 * 60;

    private final CompanyRepository companies;
    private final SpecialistRepository specialists;
    private final ServiceItemRepository services;
    private final WorkingHoursRepository workingHours;
    private final ScheduleExceptionRepository exceptions;
    private final BookingRepository bookings;
    private final QtimeProperties properties;
    private final Clock clock;

    public SlotService(CompanyRepository companies,
                       SpecialistRepository specialists,
                       ServiceItemRepository services,
                       WorkingHoursRepository workingHours,
                       ScheduleExceptionRepository exceptions,
                       BookingRepository bookings,
                       QtimeProperties properties,
                       Clock clock) {
        this.companies = companies;
        this.specialists = specialists;
        this.services = services;
        this.workingHours = workingHours;
        this.exceptions = exceptions;
        this.bookings = bookings;
        this.properties = properties;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ the grid

    /** The grid of one specialist, one service, one date. */
    @Transactional(readOnly = true)
    public SlotGrid slots(String specialistId, String serviceId, LocalDate date) {
        if (date == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_BOOKING, "date is required");
        }
        Specialist specialist = requireSpecialist(specialistId);
        Company company = requireCompany(specialist.getCompanyId());
        ServiceItem service = requireOfferedBy(specialist, requireService(serviceId));

        ZoneId zone = company.zone();
        LocalDate today = LocalDate.now(clock.withZone(zone));
        requireDateWithinHorizon(today, date);

        List<WorkingWindow> windows = windowsFor(specialist, date);
        if (windows.isEmpty()) {
            // A day off is an empty grid, not an error: "в воскресенье не работаем" is
            // information, and a client asking about Sunday should get it.
            log.debug("specialist {} does not work on {}", specialistId, date);
            return SlotGrid.closed(specialist.getId(), service.getId(), service.getDurationMinutes(),
                    zone.getId(), date);
        }

        // One query for the whole day: the grid asks "does anything block this cell?"
        // up to twenty times, and it must not become twenty round trips.
        Instant dayFrom = date.atStartOfDay(zone).toInstant();
        Instant dayTo = date.plusDays(1).atStartOfDay(zone).toInstant();
        List<Booking> busy = bookings.findActiveBetween(specialist.getId(), BookingStatus.CONFIRMED,
                dayFrom, dayTo);

        Instant earliest = clock.instant()
                .plus(Duration.ofMinutes(properties.effectiveMinLeadTimeMinutes()));
        int step = properties.effectiveSlotStepMinutes();
        int duration = service.getDurationMinutes();

        List<Slot> slots = new ArrayList<>();
        for (WorkingWindow window : windows) {
            slots.addAll(cells(window, date, zone, step, duration, earliest, busy));
        }
        slots.sort(Comparator.comparing(Slot::startsAt));

        log.debug("specialist {} has {} cells ({} free) for service {} on {}",
                specialist.getId(), slots.size(), slots.stream().filter(Slot::available).count(),
                service.getId(), date);
        return new SlotGrid(specialist.getId(), service.getId(), duration, zone.getId(), date, slots);
    }

    private List<Slot> cells(WorkingWindow window, LocalDate date, ZoneId zone, int step, int duration,
                             Instant earliest, List<Booking> busy) {
        List<Slot> cells = new ArrayList<>();
        for (int from = window.startMinutes(); from < window.endMinutes(); from += step) {
            Instant startsAt = date.atTime(from / 60, from % 60).atZone(zone).toInstant();
            if (startsAt.isBefore(earliest)) {
                // Too soon to be promised, or already gone: the grid starts later.
                continue;
            }
            int to = from + duration;
            // A service that would run past midnight has no end instant to talk about,
            // so it can never fit inside a shift — mark it and move on.
            if (to > MINUTES_PER_DAY) {
                cells.add(Slot.taken(startsAt, startsAt.plus(Duration.ofMinutes(duration)),
                        SlotUnavailability.NOT_ENOUGH_TIME));
                continue;
            }
            Instant endsAt = date.atTime(to / 60, to % 60).atZone(zone).toInstant();

            SlotUnavailability reason = reasonFor(window, from, to, startsAt, endsAt, busy);
            cells.add(reason == null ? Slot.free(startsAt, endsAt) : Slot.taken(startsAt, endsAt, reason));
        }
        return cells;
    }

    /**
     * Why a cell cannot be taken, or {@code null} when it can.
     *
     * <p>Order matters for the person reading the screen: "не хватает времени" and
     * "перерыв" are facts about the schedule (they will be true tomorrow as well),
     * while "занято" is a fact about other clients and may change in an hour.
     */
    private SlotUnavailability reasonFor(WorkingWindow window, int from, int to,
                                         Instant startsAt, Instant endsAt, List<Booking> busy) {
        if (!window.insideShift(from, to)) {
            return SlotUnavailability.NOT_ENOUGH_TIME;
        }
        if (window.crossesBreak(from, to)) {
            return SlotUnavailability.BREAK;
        }
        for (Booking booking : busy) {
            if (booking.blocks(startsAt, endsAt)) {
                return SlotUnavailability.BUSY;
            }
        }
        return null;
    }

    // ------------------------------------------------------------------ booking-time checks

    /**
     * Refuses a concrete {@code startsAt} that the calendar cannot honour.
     *
     * <p>Called inside the booking transaction, which is the point: the grid a client
     * saw was computed a moment ago, and the only thing that may be assumed about it
     * is that it was true then. The checks are the same three the grid makes — inside
     * the shift, clear of the break, within the horizon — plus the lead time.
     */
    @Transactional(readOnly = true)
    public void requireWithinWorkingHours(Specialist specialist, Company company,
                                          int durationMinutes, Instant startsAt) {
        ZoneId zone = company.zone();
        Instant now = clock.instant();
        LocalDate date = startsAt.atZone(zone).toLocalDate();
        LocalDate today = LocalDate.now(clock.withZone(zone));

        if (startsAt.isBefore(now) || date.isBefore(today)) {
            throw DomainException.of(QtimeErrorCode.BOOKING_IN_PAST,
                            "booking start {} is in the past", startsAt)
                    .withDetail("startsAt", startsAt.toString());
        }
        Instant earliest = now.plus(Duration.ofMinutes(properties.effectiveMinLeadTimeMinutes()));
        if (startsAt.isBefore(earliest)) {
            throw DomainException.of(QtimeErrorCode.BOOKING_TOO_SOON,
                            "the earliest bookable time is {} ({} minutes from now)",
                            earliest, properties.effectiveMinLeadTimeMinutes())
                    .withDetail("earliestBookableAt", earliest.toString())
                    .withDetail("minLeadTimeMinutes", properties.effectiveMinLeadTimeMinutes());
        }
        requireDateWithinHorizon(today, date);

        List<WorkingWindow> windows = windowsFor(specialist, date);
        if (windows.isEmpty()) {
            throw DomainException.of(QtimeErrorCode.OUTSIDE_WORKING_HOURS,
                            "specialist {} does not work on {}", specialist.getId(), date)
                    .withDetail("date", date.toString())
                    .withDetail("reason", "DAY_OFF");
        }

        LocalTime from = startsAt.atZone(zone).toLocalTime();
        int fromMinutes = WorkingWindow.minutes(from);
        int toMinutes = fromMinutes + durationMinutes;
        for (WorkingWindow window : windows) {
            if (window.covers(fromMinutes, toMinutes)) {
                return;
            }
            if (window.hitsBreak(fromMinutes, toMinutes)) {
                throw DomainException.of(QtimeErrorCode.OUTSIDE_WORKING_HOURS,
                                "service of {} minutes at {} runs into the break {}-{}",
                                durationMinutes, from, window.breakStart(), window.breakEnd())
                        .withDetail("date", date.toString())
                        .withDetail("reason", "BREAK");
            }
        }
        throw DomainException.of(QtimeErrorCode.OUTSIDE_WORKING_HOURS,
                        "service of {} minutes at {} ({} local) does not fit the working day of specialist {}",
                        durationMinutes, startsAt, from, specialist.getId())
                .withDetail("date", date.toString())
                .withDetail("reason", windows.stream().anyMatch(w -> w.intersects(fromMinutes, toMinutes))
                        ? "CROSSES_SHIFT" : "OUTSIDE_SHIFT");
    }

    // ------------------------------------------------------------------ windows

    /**
     * The windows of one date: the exception if there is one, the weekly rule otherwise.
     *
     * <p>An exception wins outright. A vacation is not a constraint to intersect with
     * the week — it is the answer for that date, and intersecting it with the rule
     * would publish the very windows the master is away for.
     */
    List<WorkingWindow> windowsFor(Specialist specialist, LocalDate date) {
        ScheduleException exception = exceptions
                .findBySpecialistIdAndExceptionDate(specialist.getId(), date)
                .orElse(null);
        if (exception != null) {
            if (exception.closesDay()) {
                log.debug("specialist {} is away on {} ({})", specialist.getId(), date, exception.getKind());
                return List.of();
            }
            return List.of(WorkingWindow.extraShift(exception));
        }
        return workingHours.findBySpecialistIdAndDayOfWeek(specialist.getId(), date.getDayOfWeek()).stream()
                .map(WorkingWindow::of)
                .toList();
    }

    private void requireDateWithinHorizon(LocalDate today, LocalDate date) {
        if (date.isBefore(today)) {
            throw DomainException.of(QtimeErrorCode.BOOKING_IN_PAST,
                            "date {} is in the past", date)
                    .withDetail("date", date.toString());
        }
        LocalDate lastBookable = today.plusDays(properties.effectiveBookingHorizonDays() - 1L);
        if (date.isAfter(lastBookable)) {
            throw DomainException.of(QtimeErrorCode.OUTSIDE_BOOKING_HORIZON,
                            "bookings are open until {} ({} days ahead)", lastBookable,
                            properties.effectiveBookingHorizonDays())
                    .withDetail("date", date.toString())
                    .withDetail("lastBookableDate", lastBookable.toString());
        }
    }

    // ------------------------------------------------------------------ lookups

    @Transactional(readOnly = true)
    public Specialist requireSpecialist(String specialistId) {
        return specialists.findById(specialistId)
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.SPECIALIST_NOT_FOUND,
                                "specialist {} not found", specialistId)
                        .withDetail("specialistId", specialistId));
    }

    @Transactional(readOnly = true)
    public Company requireCompany(String companyId) {
        return companies.findById(companyId)
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.COMPANY_NOT_FOUND,
                                "company {} not found", companyId)
                        .withDetail("companyId", companyId));
    }

    @Transactional(readOnly = true)
    public ServiceItem requireService(String serviceId) {
        return services.findById(serviceId)
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.SERVICE_NOT_FOUND,
                                "service {} not found", serviceId)
                        .withDetail("serviceId", serviceId));
    }

    /**
     * Ensures the specialist can actually perform the service.
     *
     * <p>Two ways to fail: the offer belongs to another company, or it is personal to
     * another master ("наращивание ресниц делает только Динара"). Both are client bugs
     * rather than calendar facts, hence 400.
     */
    private ServiceItem requireOfferedBy(Specialist specialist, ServiceItem service) {
        if (!service.belongsToCompany(specialist.getCompanyId()) || !service.offeredBy(specialist.getId())) {
            throw DomainException.of(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST,
                            "specialist {} does not provide service {}", specialist.getId(), service.getId())
                    .withDetail("specialistId", specialist.getId())
                    .withDetail("serviceId", service.getId());
        }
        return service;
    }
}
