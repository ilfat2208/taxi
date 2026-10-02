package kz.taxi.qtime.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.BookingStatus;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;
import kz.taxi.qtime.infrastructure.BookingRepository;
import kz.taxi.qtime.infrastructure.CompanyRepository;
import kz.taxi.qtime.infrastructure.ServiceItemRepository;
import kz.taxi.qtime.infrastructure.SpecialistRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Use cases around a booking: take a window, list my appointments, release a window,
 * close a visit.
 *
 * <p>The interesting part is the order of the checks in {@link #book}, because each
 * step costs more than the previous one and each answers a different question:
 *
 * <ol>
 *   <li>does the specialist offer this service at all (400 — a client bug);</li>
 *   <li>is the company still working (422 — the salon is under review);</li>
 *   <li>is the time inside the working week, in the future, and within the horizon
 *       (422, computed by {@link SlotService} so the grid and the booking agree);</li>
 *   <li>is the window still free (409, and then the database says it again).</li>
 * </ol>
 *
 * <p><b>Concurrency.</b> "Is it free?" and "take it" cannot be one atomic step in SQL
 * without an exclusion constraint (see the migration for why the deployment is not
 * asked to install {@code btree_gist}). Two mechanisms close the gap instead:
 * the pessimistic lock taken by {@code SpecialistRepository.findByIdForBooking}
 * serializes bookings of one specialist, so the second transaction re-reads the
 * intervals after the first commits; and the partial unique index
 * {@code booking_slot_unique} decides between two inserts that still race for the very
 * same start. The loser of that race gets {@code 409 SLOT_TAKEN} rather than a 500,
 * which is the difference between "выберите другое время" and a support ticket.
 */
@Service
@Slf4j
public class BookingApplicationService {

    private final BookingRepository bookings;
    private final CompanyRepository companies;
    private final SpecialistRepository specialists;
    private final ServiceItemRepository services;
    private final SlotService slots;
    private final OutboxWriter outboxWriter;
    private final Clock clock;

    public BookingApplicationService(BookingRepository bookings,
                                     CompanyRepository companies,
                                     SpecialistRepository specialists,
                                     ServiceItemRepository services,
                                     SlotService slots,
                                     OutboxWriter outboxWriter,
                                     Clock clock) {
        this.bookings = bookings;
        this.companies = companies;
        this.specialists = specialists;
        this.services = services;
        this.slots = slots;
        this.outboxWriter = outboxWriter;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ taking a window

    /**
     * Takes the window, or explains why it cannot be taken.
     *
     * <p>Idempotency is deliberately <em>not</em> handled here: the controller wraps this
     * call in {@code IdempotencyGuard}, because the guard has to see the request body it
     * hashes. A retried request therefore never reaches this method twice, which is what
     * makes "повтор с тем же Idempotency-Key возвращает ту же запись" true.
     */
    @Transactional
    public BookingWithNames book(AuthenticatedUser user, CreateBookingCommand command) {
        QtimeAccess.requireBookingClient(user);
        if (command.startsAt() == null) {
            throw DomainException.of(QtimeErrorCode.INVALID_BOOKING, "startsAt is required");
        }

        // The row lock is taken before anything is read or decided: it is what makes
        // the interval check below and the insert that follows it one serialized step
        // per specialist.
        Specialist specialist = specialists.findByIdForBooking(command.specialistId())
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.SPECIALIST_NOT_FOUND,
                                "specialist {} not found", command.specialistId())
                        .withDetail("specialistId", command.specialistId()));
        Company company = companies.findById(specialist.getCompanyId())
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.COMPANY_NOT_FOUND,
                                "company {} not found", specialist.getCompanyId())
                        .withDetail("companyId", specialist.getCompanyId()));
        ServiceItem service = services.findById(command.serviceId())
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.SERVICE_NOT_FOUND,
                                "service {} not found", command.serviceId())
                        .withDetail("serviceId", command.serviceId()));

        // Asked before the calendar is consulted, so a mismatched pair is reported as the
        // client bug it is instead of as "вне рабочих часов".
        requireOffered(specialist, service);
        if (!company.acceptsBookings()) {
            throw DomainException.of(QtimeErrorCode.COMPANY_NOT_AVAILABLE,
                            "company {} is {} and takes no new bookings",
                            company.getId(), company.getStatus())
                    .withDetail("companyId", company.getId())
                    .withDetail("status", company.getStatus().name());
        }

        Instant now = clock.instant();
        slots.requireWithinWorkingHours(specialist, company, service.getDurationMinutes(), command.startsAt());

        Instant startsAt = command.startsAt();
        Instant endsAt = startsAt.plus(Duration.ofMinutes(service.getDurationMinutes()));
        requireFree(specialist, startsAt, endsAt);

        Booking booking = Booking.confirm(user.userId(), company, specialist, service,
                startsAt, command.comment(), now);
        Booking saved;
        try {
            // Flushed now, not at commit: that turns losing the race for this window into
            // a 409 with a business meaning instead of a constraint violation at the
            // transaction boundary, where nothing can be said about it any more.
            saved = bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException race) {
            throw lostRace(race, specialist, startsAt);
        }

        BookingWithNames created = new BookingWithNames(saved, company, specialist, service);
        publish(created, KafkaTopics.Events.BOOKING_CREATED, now);
        log.info("booking {} ({}) taken: specialist {} at {} for user {}",
                saved.getId(), saved.getCode(), specialist.getId(), saved.getStartsAt(), user.userId());
        return created;
    }

    /** Refuses a window that an active booking already occupies. */
    private void requireFree(Specialist specialist, Instant startsAt, Instant endsAt) {
        // The query already asks for overlapping rows (half-open intervals: a booking
        // ending exactly at startsAt does not overlap), and `blocks` says the same thing
        // in Java so the rule holds for every caller, not only for this query.
        for (Booking existing : bookings.findActiveBetween(specialist.getId(), BookingStatus.CONFIRMED,
                startsAt, endsAt)) {
            if (existing.blocks(startsAt, endsAt)) {
                throw DomainException.of(QtimeErrorCode.SLOT_TAKEN,
                                "specialist {} is already booked {} - {}",
                                specialist.getId(), existing.getStartsAt(), existing.getEndsAt())
                        .withDetail("specialistId", specialist.getId())
                        .withDetail("startsAt", startsAt.toString())
                        .withDetail("takenBy", existing.getCode());
            }
        }
    }

    /**
     * Turns the database's verdict on a lost race into the API's.
     *
     * <p>The unique index on the window and the unique index on the code are both
     * checked by the same exception type, and only one of them means "вы не успели": a
     * code collision would be a bug rather than a busy salon, and dressing it up as a
     * taken window would hide it. Anything that is not the slot index is therefore
     * rethrown as it is — a 500 for an on-call engineer, not a 409 for a client.
     */
    private RuntimeException lostRace(DataIntegrityViolationException race, Specialist specialist,
                                      Instant startsAt) {
        Throwable root = race.getMostSpecificCause();
        String message = root == null ? String.valueOf(race.getMessage()) : String.valueOf(root.getMessage());
        if (message != null && message.contains("booking_slot_unique")) {
            log.info("lost the race for specialist {} at {}: {}", specialist.getId(), startsAt, message);
            return DomainException.of(QtimeErrorCode.SLOT_TAKEN,
                            "specialist {} was booked for {} while this request was in flight",
                            specialist.getId(), startsAt)
                    .withDetail("specialistId", specialist.getId())
                    .withDetail("startsAt", startsAt.toString());
        }
        log.error("booking insert failed for an unexpected reason", race);
        return race;
    }

    private void requireOffered(Specialist specialist, ServiceItem service) {
        if (!service.belongsToCompany(specialist.getCompanyId()) || !service.offeredBy(specialist.getId())) {
            throw DomainException.of(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST,
                            "specialist {} does not provide service {}", specialist.getId(), service.getId())
                    .withDetail("specialistId", specialist.getId())
                    .withDetail("serviceId", service.getId());
        }
    }

    // ------------------------------------------------------------------ reading

    /**
     * The caller's own bookings; SUPPORT and ADMIN see everybody's.
     *
     * <p>Newest first, not soonest first: the screen this feeds is "мои записи", opened
     * right after making one, and the booking just made must be at the top.
     */
    @Transactional(readOnly = true)
    public PageResponse<BookingWithNames> list(AuthenticatedUser user, BookingStatus status,
                                               int page, int size) {
        Pageable pageable = PageRequest.of(Math.max(page, 0), size);
        Page<Booking> found = QtimeAccess.readsEverything(user)
                ? (status == null ? bookings.findAllByOrderByStartsAtDesc(pageable)
                                  : bookings.findByStatusOrderByStartsAtDesc(status, pageable))
                : (status == null
                        ? bookings.findByClientUserIdOrderByStartsAtDesc(user.userId(), pageable)
                        : bookings.findByClientUserIdAndStatusOrderByStartsAtDesc(user.userId(), status,
                                pageable));
        return PageResponse.of(withNames(found.getContent()), found.getNumber(), found.getSize(),
                found.getTotalElements());
    }

    @Transactional(readOnly = true)
    public BookingWithNames get(AuthenticatedUser user, String bookingId) {
        BookingWithNames found = requireBooking(bookingId);
        QtimeAccess.requireAccess(user, found.booking());
        return found;
    }

    /**
     * Resolves the names of a page of bookings with three queries.
     *
     * <p>Not three per row: a page of twenty appointments would otherwise be sixty-one
     * queries, which is how a listing endpoint quietly becomes the slowest thing in the
     * system. A row whose company or service has been deleted keeps its snapshot fields
     * but gets a null reference — the response then omits the name instead of failing the
     * whole page.
     */
    private List<BookingWithNames> withNames(List<Booking> page) {
        Map<String, Company> companyById = byId(companies.findAllById(page.stream()
                .map(Booking::getCompanyId).distinct().toList()), Company::getId);
        Map<String, Specialist> specialistById = byId(specialists.findAllById(page.stream()
                .map(Booking::getSpecialistId).distinct().toList()), Specialist::getId);
        Map<String, ServiceItem> serviceById = byId(services.findAllById(page.stream()
                .map(Booking::getServiceId).distinct().toList()), ServiceItem::getId);
        return page.stream()
                .map(booking -> new BookingWithNames(booking,
                        companyById.get(booking.getCompanyId()),
                        specialistById.get(booking.getSpecialistId()),
                        serviceById.get(booking.getServiceId())))
                .toList();
    }

    private static <T> Map<String, T> byId(List<T> rows, Function<T, String> id) {
        return rows.stream().collect(Collectors.toMap(id, Function.identity(),
                (first, second) -> first, HashMap::new));
    }

    // ------------------------------------------------------------------ releasing a window

    /**
     * Cancels a booking.
     *
     * <p>Who cancelled decides the resulting status: a client's change of mind and a
     * salon closing are different numbers in a CRM, and the status carries the
     * distinction so no reporting query has to guess it from a free-text reason.
     *
     * <p>The window is freed by the status change alone — the unique index is partial
     * over CONFIRMED — so nothing has to be deleted and the history stays complete.
     */
    @Transactional
    public BookingWithNames cancel(AuthenticatedUser user, String bookingId, String reason) {
        BookingWithNames found = requireBooking(bookingId);
        boolean byCompany = QtimeAccess.isCompanySide(user);
        if (!byCompany) {
            QtimeAccess.requireAccess(user, found.booking());
        }
        Instant now = clock.instant();
        found.booking().cancel(reason, byCompany, now);
        publish(found, KafkaTopics.Events.BOOKING_CANCELLED, now);
        log.info("booking {} ({}) cancelled by {} ({})", found.booking().getId(), found.booking().getCode(),
                user == null ? "system" : user.userId(), byCompany ? "company" : "client");
        return found;
    }

    // ------------------------------------------------------------------ closing a visit

    /**
     * Marks the visit as done — the internal endpoint ORTA Business calls (or, later,
     * the operator's calendar). Idempotent on repeat: the second call returns the same
     * COMPLETED booking instead of a 409, because a retried internal call must not look
     * like a conflict to the caller.
     */
    @Transactional
    public BookingWithNames complete(String bookingId) {
        BookingWithNames found = requireBooking(bookingId);
        Booking booking = found.booking();
        if (booking.getStatus() == BookingStatus.COMPLETED) {
            log.debug("booking {} is already completed, nothing to do", bookingId);
            return found;
        }
        Instant now = clock.instant();
        booking.complete(now);
        publish(found, KafkaTopics.Events.BOOKING_COMPLETED, now);
        log.info("booking {} ({}) completed", booking.getId(), booking.getCode());
        return found;
    }

    // ------------------------------------------------------------------ helpers

    private BookingWithNames requireBooking(String bookingId) {
        Booking booking = bookings.findById(bookingId)
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.BOOKING_NOT_FOUND,
                                "booking {} not found", bookingId)
                        .withDetail("bookingId", bookingId));
        Company company = companies.findById(booking.getCompanyId()).orElse(null);
        Specialist specialist = specialists.findById(booking.getSpecialistId()).orElse(null);
        ServiceItem service = services.findById(booking.getServiceId()).orElse(null);
        return new BookingWithNames(booking, company, specialist, service);
    }

    /**
     * Each state change is announced in the same transaction as the change itself.
     *
     * <p>Notifications, the ORTA Business calendar and the future payment hold all act
     * on these events; a booking that exists while the event was lost would be an
     * appointment nobody is told about, which is why the outbox row commits with the
     * booking rather than after it.
     */
    private void publish(BookingWithNames booking, String eventType, Instant now) {
        outboxWriter.append(KafkaTopics.QTIME_EVENTS, eventType, "Booking",
                booking.booking().getId(), booking.booking().getVersion(),
                QtimeEvents.BookingEvent.of(booking, now));
    }
}
