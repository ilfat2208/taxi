package kz.taxi.qtime.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.Roles;
import kz.taxi.qtime.QtimeFixtures;
import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.BookingStatus;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The booking use cases: what the platform promises a client who taps "записаться".
 *
 * <p>Two things are checked here and nowhere else. First, the refusals — a service that
 * belongs to another master, a window somebody already took, a time outside the shift —
 * because each of them is a rule the phone's UI cannot enforce. Second, that a booking
 * and its {@code booking.created} event are written together: an appointment nobody is
 * told about is worse than no appointment at all.
 */
@ExtendWith(MockitoExtension.class)
class BookingApplicationServiceTest {

    private static final String CLIENT = "U-1";
    private static final String OTHER_CLIENT = "U-2";

    @Mock
    private BookingRepository bookings;

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
    private OutboxWriter outboxWriter;

    private final QtimeProperties properties = new QtimeProperties();
    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);

    private final AuthenticatedUser clientUser =
            new AuthenticatedUser(CLIENT, "+77001234567", "Айша", Set.of(Roles.CUSTOMER));
    private final AuthenticatedUser merchantUser =
            new AuthenticatedUser("M-1", "+77009999999", "Салон", Set.of(Roles.MERCHANT));
    private final AuthenticatedUser otherClient =
            new AuthenticatedUser(OTHER_CLIENT, "+77005555555", "Прохожий", Set.of(Roles.CUSTOMER));

    private BookingApplicationService service;
    private ServiceItem service90;

    @BeforeEach
    void setUp() {
        // Now is 09:00 local on the fixture date; the grid, the lead time and the horizon
        // are all measured from that instant.
        service = new BookingApplicationService(bookings, companies, specialists, services, slotService(),
                outboxWriter, Clock.fixed(QtimeFixtures.NOW, ZoneOffset.UTC));
        service90 = QtimeFixtures.service(company, 90, 450_000L);
        lenient().when(specialists.findById(specialist.getId())).thenReturn(Optional.of(specialist));
        lenient().when(specialists.findByIdForBooking(specialist.getId())).thenReturn(Optional.of(specialist));
        lenient().when(companies.findById(company.getId())).thenReturn(Optional.of(company));
        lenient().when(services.findById(service90.getId())).thenReturn(Optional.of(service90));
        lenient().when(bookings.saveAndFlush(any(Booking.class))).thenAnswer(call -> call.getArgument(0));
    }

    /** The real slot service over the same mocks: the calendar rules are not stubbed out. */
    private SlotService slotService() {
        SlotService slots = new SlotService(companies, specialists, services, workingHours, exceptions, bookings,
                properties, Clock.fixed(QtimeFixtures.NOW, ZoneOffset.UTC));
        lenient().when(workingHours.findBySpecialistIdAndDayOfWeek(eq(specialist.getId()), any(DayOfWeek.class)))
                .thenReturn(List.of(QtimeFixtures.workingDay(specialist, QtimeFixtures.DATE.getDayOfWeek())));
        return slots;
    }

    private CreateBookingCommand command(LocalTime localTime, String serviceId) {
        return new CreateBookingCommand(specialist.getId(), serviceId, QtimeFixtures.at(localTime), "домофон 45");
    }

    /** An existing booking at a local time on the fixture date, owned by {@code userId}. */
    private Booking ownedBy(String userId, LocalTime localTime) {
        return QtimeFixtures.booking(company, specialist, service90, QtimeFixtures.at(localTime), userId);
    }

    private static List<Booking> noBookings() {
        return List.of();
    }

    // ------------------------------------------------------------------ booking

    @Test
    @DisplayName("a free window is taken, and booking.created is queued in the same transaction")
    void books_a_free_window() {
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED), any(), any()))
                .thenReturn(noBookings());

        BookingWithNames created = service.book(clientUser, command(LocalTime.of(15, 30), service90.getId()));

        assertThat(created.booking().getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(created.booking().getClientUserId()).isEqualTo(CLIENT);
        assertThat(created.booking().getEndsAt()).isEqualTo(QtimeFixtures.at(LocalTime.of(17, 0)));
        // The price is the snapshot the client was quoted, in minor units.
        assertThat(created.booking().getPriceMinor()).isEqualTo(450_000L);
        assertThat(created.company()).isEqualTo(company);
        assertThat(created.specialist()).isEqualTo(specialist);
        assertThat(created.service()).isEqualTo(service90);

        ArgumentCaptor<QtimeEvents.BookingEvent> event = ArgumentCaptor.forClass(QtimeEvents.BookingEvent.class);
        verify(outboxWriter).append(eq(KafkaTopics.QTIME_EVENTS), eq(KafkaTopics.Events.BOOKING_CREATED),
                eq("Booking"), eq(created.booking().getId()), anyLong(), event.capture());
        // The payload is self-contained: a consumer must not have to call back for a name.
        assertThat(event.getValue().companyName()).isEqualTo(company.getName());
        assertThat(event.getValue().specialistName()).isEqualTo(specialist.getFullName());
        assertThat(event.getValue().serviceName()).isEqualTo(service90.getName());
        assertThat(event.getValue().priceMinor()).isEqualTo(450_000L);
    }

    @Test
    @DisplayName("a window an active booking already overlaps is 409 SLOT_TAKEN, and nothing is written")
    void refuses_a_taken_window() {
        Booking existing = ownedBy(CLIENT, LocalTime.of(15, 30));
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED), any(), any()))
                .thenReturn(List.of(existing));

        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(15, 30), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SLOT_TAKEN);
                    assertThat(ex.details()).containsEntry("takenBy", existing.getCode());
                });

        verify(bookings, never()).saveAndFlush(any(Booking.class));
        verifyNoInteractions(outboxWriter);
    }

    @Test
    @DisplayName("a window that only partially overlaps is taken as well: intervals, not start times")
    void refuses_a_partially_overlapping_window() {
        ServiceItem thirty = QtimeFixtures.service(company, 30, 250_000L);
        when(services.findById(thirty.getId())).thenReturn(Optional.of(thirty));
        // Somebody holds 15:00-16:30.
        Booking existing = ownedBy(CLIENT, LocalTime.of(15, 0));
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED), any(), any()))
                .thenReturn(List.of(existing));

        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(16, 0), thirty.getId())))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SLOT_TAKEN));
    }

    @Test
    @DisplayName("losing the race to the unique index is a 409, not a 500")
    void translates_the_unique_index_race() {
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED), any(), any()))
                .thenReturn(noBookings());
        when(bookings.saveAndFlush(any(Booking.class))).thenThrow(new DataIntegrityViolationException(
                "duplicate key value violates unique constraint \"booking_slot_unique\""));

        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(15, 30), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SLOT_TAKEN);
                    assertThat(ex.details()).containsKey("specialistId");
                });
    }

    @Test
    @DisplayName("an unexpected integrity failure stays a server error instead of becoming a business refusal")
    void does_not_disguise_other_failures() {
        when(bookings.findActiveBetween(eq(specialist.getId()), eq(BookingStatus.CONFIRMED), any(), any()))
                .thenReturn(noBookings());
        when(bookings.saveAndFlush(any(Booking.class))).thenThrow(
                new DataIntegrityViolationException("insert or update on table violates foreign key constraint"));

        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(15, 30), service90.getId())))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("a time that already passed is 422 BOOKING_IN_PAST")
    void refuses_a_booking_in_the_past() {
        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(4, 0), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_IN_PAST);
                    assertThat(ex.details()).containsEntry("startsAt",
                            QtimeFixtures.at(LocalTime.of(4, 0)).toString());
                });
        verify(bookings, never()).saveAndFlush(any(Booking.class));
    }

    @Test
    @DisplayName("a time after closing is 422 OUTSIDE_WORKING_HOURS")
    void refuses_a_booking_after_closing() {
        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(21, 0), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_WORKING_HOURS);
                    assertThat(ex.details()).containsEntry("reason", "OUTSIDE_SHIFT");
                });
        verify(bookings, never()).saveAndFlush(any(Booking.class));
    }

    @Test
    @DisplayName("a booking that would run into the lunch break is refused")
    void refuses_a_booking_that_crosses_lunch() {
        // 12:30 + 90 minutes = 14:00, straight through the 13:00-14:00 break.
        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(12, 30), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_WORKING_HOURS);
                    assertThat(ex.details()).containsEntry("reason", "BREAK");
                });
    }

    @Test
    @DisplayName("a time inside the lead time is 422 BOOKING_TOO_SOON")
    void refuses_a_booking_that_is_too_soon() {
        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(9, 15), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_TOO_SOON));
    }

    @Test
    @DisplayName("a date beyond the horizon is 422 OUTSIDE_BOOKING_HORIZON")
    void refuses_a_booking_beyond_the_horizon() {
        Instant far = QtimeFixtures.at(QtimeFixtures.DATE.plusDays(45), LocalTime.of(15, 0));

        assertThatThrownBy(() -> service.book(clientUser,
                new CreateBookingCommand(specialist.getId(), service90.getId(), far, null)))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.OUTSIDE_BOOKING_HORIZON));
    }

    @Test
    @DisplayName("a service another master performs is a 400, before any calendar question")
    void refuses_a_service_of_another_specialist() {
        Specialist other = Specialist.register(company.getId(), "Динара", "мастер ресниц", 48_000, 4,
                QtimeFixtures.NOW);
        ServiceItem personal = QtimeFixtures.personalService(company, other, 120, 1_200_000L);
        when(services.findById(personal.getId())).thenReturn(Optional.of(personal));

        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(15, 0), personal.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SERVICE_NOT_OFFERED_BY_SPECIALIST);
                    assertThat(ex.details()).containsEntry("serviceId", personal.getId());
                });
        verifyNoInteractions(outboxWriter);
    }

    @Test
    @DisplayName("an unknown specialist is a 404")
    void refuses_an_unknown_specialist() {
        when(specialists.findByIdForBooking("01UNKNOWN")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.book(clientUser, new CreateBookingCommand("01UNKNOWN",
                service90.getId(), QtimeFixtures.at(LocalTime.of(15, 0)), null)))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.SPECIALIST_NOT_FOUND));
    }

    @Test
    @DisplayName("a merchant cannot take a window on a client's behalf")
    void refuses_a_non_customer() {
        assertThatThrownBy(() -> service.book(merchantUser, command(LocalTime.of(15, 30), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.CUSTOMER_ROLE_REQUIRED));
        verifyNoInteractions(bookings);
    }

    @Test
    @DisplayName("a company that is not accepting bookings refuses with 422, not with a slot error")
    void refuses_a_suspended_company() {
        company.suspend(QtimeFixtures.NOW);

        assertThatThrownBy(() -> service.book(clientUser, command(LocalTime.of(15, 30), service90.getId())))
                .isInstanceOfSatisfying(DomainException.class, ex -> {
                    assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.COMPANY_NOT_AVAILABLE);
                    assertThat(ex.details()).containsEntry("status", "SUSPENDED");
                });
    }

    // ------------------------------------------------------------------ cancelling

    @Test
    @DisplayName("the owner cancels, the window is free again, booking.cancelled is queued")
    void owner_cancels() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        BookingWithNames cancelled = service.cancel(clientUser, booking.getId(), "заболела");

        assertThat(cancelled.booking().getStatus()).isEqualTo(BookingStatus.CANCELLED_BY_CLIENT);
        assertThat(cancelled.booking().getCancelReason()).isEqualTo("заболела");
        // Freeing the window is a status change and nothing else — the index is partial.
        assertThat(cancelled.booking().occupiesSlot()).isFalse();
        verify(outboxWriter).append(eq(KafkaTopics.QTIME_EVENTS), eq(KafkaTopics.Events.BOOKING_CANCELLED),
                eq("Booking"), eq(booking.getId()), anyLong(), any(QtimeEvents.BookingEvent.class));
    }

    @Test
    @DisplayName("somebody else's booking cannot be cancelled: 403")
    void refuses_cancelling_somebody_elses_booking() {
        // Taken by the client under test, so a cancellation from another client is not his
        // to make.
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        assertThatThrownBy(() -> service.cancel(otherClient, booking.getId(), null))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.FORBIDDEN_BOOKING_ACCESS));

        assertThat(booking.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        verifyNoInteractions(outboxWriter);
    }

    @Test
    @DisplayName("a merchant cancels as the company, and the status says so")
    void merchant_cancels_as_the_company() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        BookingWithNames cancelled = service.cancel(merchantUser, booking.getId(), "мастер заболел");

        assertThat(cancelled.booking().getStatus()).isEqualTo(BookingStatus.CANCELLED_BY_COMPANY);
    }

    @Test
    @DisplayName("a completed visit cannot be cancelled")
    void refuses_cancelling_a_completed_booking() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        booking.complete(QtimeFixtures.at(LocalTime.of(18, 0)));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        assertThatThrownBy(() -> service.cancel(clientUser, booking.getId(), null))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_NOT_CANCELLABLE));
    }

    @Test
    @DisplayName("an unknown booking is a 404")
    void refuses_an_unknown_booking() {
        when(bookings.findById("01MISSING")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.cancel(clientUser, "01MISSING", null))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_NOT_FOUND));
    }

    // ------------------------------------------------------------------ completing

    @Test
    @DisplayName("completing a visit publishes booking.completed and is idempotent on repeat")
    void completes_a_visit_idempotently() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        BookingWithNames completed = service.complete(booking.getId());
        assertThat(completed.booking().getStatus()).isEqualTo(BookingStatus.COMPLETED);
        // A retried internal call must not look like a conflict to the calendar that made it,
        // and it must not announce the same visit twice.
        BookingWithNames again = service.complete(booking.getId());
        assertThat(again.booking().getStatus()).isEqualTo(BookingStatus.COMPLETED);
        verify(outboxWriter, times(1)).append(eq(KafkaTopics.QTIME_EVENTS),
                eq(KafkaTopics.Events.BOOKING_COMPLETED), eq("Booking"), eq(booking.getId()), anyLong(),
                any(QtimeEvents.BookingEvent.class));
    }

    @Test
    @DisplayName("a cancelled booking cannot be completed")
    void refuses_completing_a_cancelled_booking() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        booking.cancel("передумала", false, QtimeFixtures.at(LocalTime.of(10, 0)));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        assertThatThrownBy(() -> service.complete(booking.getId()))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.BOOKING_NOT_COMPLETABLE));
    }

    // ------------------------------------------------------------------ reading

    @Test
    @DisplayName("a client sees only their own bookings")
    void lists_only_own_bookings() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        Page<Booking> page = new PageImpl<>(List.of(booking));
        when(bookings.findByClientUserIdOrderByStartsAtDesc(eq(CLIENT), any())).thenReturn(page);

        PageResponse<BookingWithNames> found = service.list(clientUser, null, 0, 20);

        assertThat(found.items()).hasSize(1);
        assertThat(found.items().get(0).booking().getClientUserId()).isEqualTo(CLIENT);
        assertThat(found.totalElements()).isEqualTo(1);
        // A merchant is not an operator: the CRM screen reads companies, not other people's
        // appointments.
        verify(bookings, never()).findAllByOrderByStartsAtDesc(any());
    }

    @Test
    @DisplayName("support sees everybody's bookings, filtered by status")
    void support_sees_everything() {
        AuthenticatedUser support = new AuthenticatedUser("S-1", "+77001112233", "Поддержка",
                Set.of(Roles.SUPPORT));
        Page<Booking> page = new PageImpl<>(List.of());
        when(bookings.findByStatusOrderByStartsAtDesc(eq(BookingStatus.CONFIRMED),
                eq(PageRequest.of(0, 20)))).thenReturn(page);

        service.list(support, BookingStatus.CONFIRMED, 0, 20);

        verify(bookings).findByStatusOrderByStartsAtDesc(eq(BookingStatus.CONFIRMED),
                eq(PageRequest.of(0, 20)));
        verify(bookings, never()).findByClientUserIdOrderByStartsAtDesc(any(), any());
    }

    @Test
    @DisplayName("reading somebody else's booking is forbidden for a client and allowed for support")
    void reading_is_owner_or_operator_only() {
        Booking booking = ownedBy(CLIENT, LocalTime.of(15, 30));
        when(bookings.findById(booking.getId())).thenReturn(Optional.of(booking));

        assertThatThrownBy(() -> service.get(otherClient, booking.getId()))
                .isInstanceOfSatisfying(DomainException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(QtimeErrorCode.FORBIDDEN_BOOKING_ACCESS));

        BookingWithNames forSupport = service.get(new AuthenticatedUser("S-1", null, "Поддержка",
                Set.of(Roles.SUPPORT)), booking.getId());
        assertThat(forSupport.booking().getId()).isEqualTo(booking.getId());
    }
}
