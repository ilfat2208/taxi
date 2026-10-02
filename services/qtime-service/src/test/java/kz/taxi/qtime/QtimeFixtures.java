package kz.taxi.qtime;

import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.CompanyCategory;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;
import kz.taxi.qtime.domain.WorkingHours;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

/**
 * The demo city the tests work in: one salon, one master, one service, a Thursday.
 *
 * <p>Fixed dates rather than {@code LocalDate.now()}: slot arithmetic is about the zone,
 * the shift, the lunch and the lead time, and a test that moves with the calendar fails
 * on a Sunday for reasons that have nothing to do with the code under test. The date is a
 * Thursday — an ordinary working day in the middle of the week, so neither end of the week
 * has to be special-cased.
 */
public final class QtimeFixtures {

    /** Asia/Almaty is UTC+5 all year: no DST to make an hour appear or disappear. */
    public static final ZoneId ZONE = ZoneId.of("Asia/Almaty");

    /** Thursday. */
    public static final LocalDate DATE = LocalDate.of(2026, 5, 14);

    /** 09:00 local on that Thursday — the moment the shift starts. */
    public static final Instant NOW = at(LocalTime.of(9, 0));

    public static final LocalTime SHIFT_START = LocalTime.of(9, 0);
    public static final LocalTime SHIFT_END = LocalTime.of(20, 0);
    public static final LocalTime LUNCH_START = LocalTime.of(13, 0);
    public static final LocalTime LUNCH_END = LocalTime.of(14, 0);

    private QtimeFixtures() {
    }

    /** Local time on {@link #DATE} as an absolute instant. */
    public static Instant at(LocalTime localTime) {
        return DATE.atTime(localTime).atZone(ZONE).toInstant();
    }

    public static Instant at(LocalDate date, LocalTime localTime) {
        return date.atTime(localTime).atZone(ZONE).toInstant();
    }

    public static Company company() {
        return Company.register("Салон красоты «Лотос»", CompanyCategory.BEAUTY, "Шымкент",
                "ул. Тауке хана, 83", 42.3170, 69.5900, ZONE.getId(), NOW);
    }

    public static Specialist specialist(Company company) {
        return Specialist.register(company.getId(), "Айгуль Смагулова", "мастер маникюра", 49_000, 6, NOW);
    }

    /** A company-wide offer: any master of the salon can take it. */
    public static ServiceItem service(Company company, int durationMinutes, long priceMinor) {
        return ServiceItem.offer(company.getId(), null, "Маникюр с покрытием", durationMinutes,
                Money.ofMinor(priceMinor, Currency.KZT), NOW);
    }

    /** An offer that belongs to one master only. */
    public static ServiceItem personalService(Company company, Specialist specialist,
                                              int durationMinutes, long priceMinor) {
        return ServiceItem.offer(company.getId(), specialist.getId(), "Наращивание ресниц", durationMinutes,
                Money.ofMinor(priceMinor, Currency.KZT), NOW);
    }

    /** Пн-сб 09:00-20:00, обед 13:00-14:00 — the rule the demo city is seeded with. */
    public static WorkingHours workingDay(Specialist specialist, DayOfWeek day) {
        return WorkingHours.rule(specialist.getId(), day, SHIFT_START, SHIFT_END,
                LUNCH_START, LUNCH_END, NOW);
    }

    /** The same shift without a break, for tests that are about time and not about lunch. */
    public static WorkingHours workingDayWithoutBreak(Specialist specialist, DayOfWeek day) {
        return WorkingHours.rule(specialist.getId(), day, SHIFT_START, SHIFT_END, null, null, NOW);
    }

    public static Booking booking(Company company, Specialist specialist, ServiceItem service,
                                 Instant startsAt, String clientUserId) {
        return Booking.confirm(clientUserId, company, specialist, service, startsAt, null, NOW);
    }

    /** A booking of the demo client, taken at a local time on {@link #DATE}. */
    public static Booking bookingAt(Company company, Specialist specialist, ServiceItem service,
                                    LocalTime localTime) {
        return booking(company, specialist, service, at(localTime), "demo-client");
    }
}
