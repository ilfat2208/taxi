package kz.taxi.qtime.infrastructure.seed;

import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.money.Money;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.CompanyCategory;
import kz.taxi.qtime.domain.ScheduleException;
import kz.taxi.qtime.domain.ScheduleExceptionKind;
import kz.taxi.qtime.domain.ServiceItem;
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
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Seeds four Shymkent companies on an empty database.
 *
 * <p>QTime with no companies cannot be demonstrated at all: the list is empty, the slot
 * grid has nobody to compute, and the first thing a reviewer does is hand-write SQL. The
 * seed is therefore part of the service — but a paranoid part:
 *
 * <ul>
 *   <li>it runs only when the company table is empty, so a restart never duplicates a
 *       salon and re-seeding a live database is impossible;</li>
 *   <li>it runs after the context is up (Flyway has migrated);</li>
 *   <li>it can be switched off with {@code taxi.qtime.demo.seed=false};</li>
 *   <li>a failure is logged and rolled back — an empty calendar is a legitimate state and
 *       demo data is not a correctness requirement of the service.</li>
 * </ul>
 *
 * <p>The four entries are deliberately the four verticals QTime is built for — салон
 * красоты, барбершоп, автосервис, стоматология — with Russian service names, real
 * Shymkent coordinates and prices in tenge, because these screens are judged on whether
 * they look like a real city rather than like lorem ipsum.
 *
 * <p>The working week is the same for every master — пн-сб 09:00-20:00, обед 13:00-14:00,
 * вс выходной, expressed as the absence of a Sunday rule — plus a handful of occupied
 * windows on today and tomorrow, so the grid shows greyed cells instead of a fully free
 * day, and one upcoming vacation, so the exception table is exercised by something a
 * reviewer can actually see.
 *
 * <p>Those demo bookings are written directly, without {@code booking.created} events:
 * nobody made these appointments, and publishing them would put notifications for
 * imaginary clients into the outbox.
 */
@Component
@Slf4j
public class DemoQtimeSeeder implements ApplicationRunner {

    private static final String CITY = "Шымкент";
    private static final String DEMO_CLIENT = "demo-client-1";
    private static final LocalTime SHIFT_START = LocalTime.of(9, 0);
    private static final LocalTime SHIFT_END = LocalTime.of(20, 0);
    private static final LocalTime LUNCH_START = LocalTime.of(13, 0);
    private static final LocalTime LUNCH_END = LocalTime.of(14, 0);

    private static final List<DemoCompany> DEMO_COMPANIES = List.of(
            new DemoCompany("Салон красоты «Лотос»", CompanyCategory.BEAUTY, "ул. Тауке хана, 83",
                    42.3170, 69.5900, 48_000, 312, List.of(
                    new DemoSpecialist("Айгуль Смагулова", "мастер маникюра", 49_000, 6, List.of(
                            new DemoService("Маникюр с покрытием", 90, 4_500, false),
                            new DemoService("Педикюр", 75, 5_500, false),
                            new DemoService("Наращивание ресниц", 120, 12_000, true))),
                    new DemoSpecialist("Динара Ахметова", "парикмахер-стилист", 48_200, 9, List.of(
                            new DemoService("Женская стрижка", 60, 6_000, false),
                            new DemoService("Окрашивание в один тон", 120, 15_000, false),
                            new DemoService("Укладка волос", 45, 4_000, false))),
                    new DemoSpecialist("Жанар Оспанова", "косметолог", 47_500, 4, List.of(
                            new DemoService("Чистка лица", 60, 9_000, false),
                            new DemoService("Пилинг лица", 45, 7_000, false))))),
            new DemoCompany("Барбершоп «Король Бороды»", CompanyCategory.BARBERSHOP, "пр. Республики, 12",
                    42.3120, 69.5820, 47_500, 208, List.of(
                    new DemoSpecialist("Ерлан Сериков", "барбер", 48_800, 7, List.of(
                            new DemoService("Мужская стрижка", 45, 4_500, false),
                            new DemoService("Стрижка бороды", 30, 2_500, false),
                            new DemoService("Комплекс: стрижка и борода", 75, 6_500, false))),
                    new DemoSpecialist("Аслан Ибраев", "барбер", 46_900, 3, List.of(
                            new DemoService("Мужская стрижка", 45, 4_000, false),
                            new DemoService("Королевское бритьё", 45, 3_500, false))),
                    new DemoSpecialist("Тимур Нурланов", "барбер", 45_200, 2, List.of(
                            new DemoService("Детская стрижка", 30, 3_000, true))))),
            new DemoCompany("Автосервис «Мотор-Сервис»", CompanyCategory.AUTO, "ул. Байтурсынова, 45",
                    42.3205, 69.5790, 46_200, 147, List.of(
                    new DemoSpecialist("Серик Жумабеков", "мастер-приёмщик", 47_900, 11, List.of(
                            new DemoService("Замена масла и фильтра", 45, 12_000, false),
                            new DemoService("Компьютерная диагностика", 60, 8_000, false),
                            new DemoService("Шиномонтаж, 4 колеса", 60, 10_000, false))),
                    new DemoSpecialist("Нурлан Касымов", "автоэлектрик", 46_100, 8, List.of(
                            new DemoService("Ремонт стартера", 120, 15_000, false),
                            new DemoService("Замена аккумулятора", 30, 3_000, false))),
                    new DemoSpecialist("Данияр Турсынов", "мастер детейлинга", 47_000, 5, List.of(
                            new DemoService("Химчистка салона", 180, 25_000, false),
                            new DemoService("Полировка кузова", 150, 30_000, false))))),
            new DemoCompany("Стоматология «Дентал Плюс»", CompanyCategory.HEALTH, "ул. Желтоксан, 20",
                    42.3090, 69.5950, 48_900, 401, List.of(
                    new DemoSpecialist("Айнур Бекова", "врач-стоматолог", 49_200, 12, List.of(
                            new DemoService("Консультация стоматолога", 30, 3_000, false),
                            new DemoService("Лечение кариеса", 60, 18_000, false),
                            new DemoService("Профессиональная чистка", 60, 12_000, false))),
                    new DemoSpecialist("Марат Сулейменов", "врач-ортопед", 48_500, 15, List.of(
                            new DemoService("Коронка из циркония", 90, 65_000, true),
                            new DemoService("Слепки и примерка", 45, 9_000, false))),
                    new DemoSpecialist("Гульнара Алиева", "врач-гигиенист", 47_300, 6, List.of(
                            new DemoService("Профессиональная чистка", 60, 11_000, false),
                            new DemoService("Отбеливание зубов", 90, 45_000, false))))));

    private final CompanyRepository companies;
    private final SpecialistRepository specialists;
    private final ServiceItemRepository services;
    private final WorkingHoursRepository workingHours;
    private final ScheduleExceptionRepository exceptions;
    private final BookingRepository bookings;
    private final TransactionTemplate transactionTemplate;
    private final ZoneId zone;
    private final boolean enabled;

    public DemoQtimeSeeder(CompanyRepository companies,
                           SpecialistRepository specialists,
                           ServiceItemRepository services,
                           WorkingHoursRepository workingHours,
                           ScheduleExceptionRepository exceptions,
                           BookingRepository bookings,
                           PlatformTransactionManager transactionManager,
                           QtimeProperties properties) {
        this.companies = companies;
        this.specialists = specialists;
        this.services = services;
        this.workingHours = workingHours;
        this.exceptions = exceptions;
        this.bookings = bookings;
        // An explicit template rather than @Transactional on run(): the runner is invoked
        // by the bootstrapper, and a self-call would silently skip the proxy.
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.zone = properties.defaultZone();
        this.enabled = properties.getDemo().isSeed();
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            log.info("demo qtime seeding disabled (taxi.qtime.demo.seed=false)");
            return;
        }
        try {
            Integer seeded = transactionTemplate.execute(status -> seedIfEmpty());
            if (seeded == null || seeded == 0) {
                log.info("demo qtime seeding skipped: the calendar already has companies");
            } else {
                log.info("seeded demo qtime: {} companies with {} specialists",
                        DEMO_COMPANIES.size(), seeded);
            }
        } catch (RuntimeException failure) {
            log.warn("demo qtime seeding failed and was rolled back: {}", failure.toString());
        }
    }

    /** One transaction: either the whole demo city exists or none of it does. */
    private int seedIfEmpty() {
        long existing = companies.count();
        if (existing > 0) {
            log.debug("calendar already contains {} companies, nothing to seed", existing);
            return 0;
        }
        Instant now = Instant.now();
        LocalDate today = ZonedDateTime.ofInstant(now, zone).toLocalDate();
        int specialistsSeeded = 0;
        Set<String> takenWindows = new HashSet<>();
        for (DemoCompany demo : DEMO_COMPANIES) {
            Company company = companies.save(Company.register(demo.name(), demo.category(), CITY,
                    demo.address(), demo.lat(), demo.lon(), zone.getId(), now));
            company.updateRating(demo.ratingBp(), demo.reviews(), now);
            for (DemoSpecialist demoSpecialist : demo.specialists()) {
                Specialist specialist = specialists.save(Specialist.register(company.getId(),
                        demoSpecialist.name(), demoSpecialist.specialization(),
                        demoSpecialist.ratingBp(), demoSpecialist.experienceYears(), now));
                seedWeek(specialist, now);
                List<ServiceItem> offers = demoSpecialist.services().stream()
                        .map(service -> services.save(ServiceItem.offer(company.getId(),
                                service.personal() ? specialist.getId() : null,
                                service.name(), service.durationMinutes(),
                                Money.of(service.priceTenge(), Currency.KZT), now)))
                        .toList();
                if (specialistsSeeded == 0) {
                    // One visible exception so the slot query's exception branch is not
                    // dead code in a demo: this master is away for three days.
                    exceptions.save(ScheduleException.close(specialist.getId(), today.plusDays(3),
                            ScheduleExceptionKind.VACATION, "отпуск (демо)", now));
                }
                seedBusyWindows(company, specialist, offers, today, now, takenWindows);
                specialistsSeeded++;
            }
        }
        return specialistsSeeded;
    }

    /**
     * Пн-сб 09:00-20:00, обед 13:00-14:00 for every master.
     *
     * <p>Sunday has no row, and that absence <em>is</em> the day off: a working week is
     * data, not a flag somebody has to keep in sync with it.
     */
    private void seedWeek(Specialist specialist, Instant now) {
        for (DayOfWeek day : List.of(DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
                DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY)) {
            workingHours.save(WorkingHours.rule(specialist.getId(), day, SHIFT_START, SHIFT_END,
                    LUNCH_START, LUNCH_END, now));
        }
    }

    /**
     * A few occupied windows, so the grid on the screen looks alive.
     *
     * <p>Today's are placed relative to the seeding moment (the next half-hour mark one and
     * three hours ahead) and tomorrow's at fixed times. A window that is already in the past
     * when the service starts is skipped: an occupancy nobody can see is not worth breaking
     * the working-hours rule for.
     */
    private void seedBusyWindows(Company company, Specialist specialist, List<ServiceItem> offers,
                                 LocalDate today, Instant now, Set<String> takenWindows) {
        if (offers.isEmpty()) {
            return;
        }
        ZonedDateTime localNow = ZonedDateTime.ofInstant(now, zone);
        ServiceItem first = offers.get(0);
        ServiceItem second = offers.size() > 1 ? offers.get(1) : first;

        take(company, specialist, first, today, nextHalfHour(localNow, 1), now, takenWindows);
        take(company, specialist, second, today, nextHalfHour(localNow, 3), now, takenWindows);
        take(company, specialist, first, today.plusDays(1), LocalTime.of(11, 30), now, takenWindows);
        take(company, specialist, second, today.plusDays(1), LocalTime.of(16, 0), now, takenWindows);
    }

    /** Books a demo window when it fits the shift, misses the lunch and is still ahead. */
    private void take(Company company, Specialist specialist, ServiceItem service, LocalDate date,
                      LocalTime time, Instant now, Set<String> takenWindows) {
        if (time == null) {
            return;
        }
        int from = workingMinutes(time);
        int to = from + service.getDurationMinutes();
        if (from < workingMinutes(SHIFT_START) || to > workingMinutes(SHIFT_END)
                || (from < workingMinutes(LUNCH_END) && to > workingMinutes(LUNCH_START))) {
            return;
        }
        Instant startsAt = date.atTime(time).atZone(zone).toInstant();
        if (startsAt.isBefore(now)) {
            return;
        }
        // Guarded against the seeder's own demo bookings as well as against the unique
        // index: a second row for the same window would abort the whole seeding.
        if (!takenWindows.add(specialist.getId() + "@" + startsAt)) {
            return;
        }
        bookings.save(Booking.confirm(DEMO_CLIENT, company, specialist, service, startsAt,
                "демо-запись: окно занято", now));
    }

    /**
     * The next half-hour mark at least {@code hoursAhead} hours from now, or {@code null}
     * when that lands on another day (the grid of tomorrow is seeded separately).
     */
    private static LocalTime nextHalfHour(ZonedDateTime localNow, int hoursAhead) {
        ZonedDateTime target = localNow.plusHours(hoursAhead).withSecond(0).withNano(0);
        ZonedDateTime aligned = target.getMinute() % 30 == 0
                ? target
                : target.plusMinutes(30 - (target.getMinute() % 30));
        return aligned.toLocalDate().equals(localNow.toLocalDate()) ? aligned.toLocalTime() : null;
    }

    private static int workingMinutes(LocalTime time) {
        return time.getHour() * 60 + time.getMinute();
    }

    private record DemoCompany(String name, CompanyCategory category, String address, double lat, double lon,
                               int ratingBp, int reviews, List<DemoSpecialist> specialists) {
    }

    private record DemoSpecialist(String name, String specialization, int ratingBp, int experienceYears,
                                  List<DemoService> services) {
    }

    private record DemoService(String name, int durationMinutes, long priceTenge, boolean personal) {
    }
}
