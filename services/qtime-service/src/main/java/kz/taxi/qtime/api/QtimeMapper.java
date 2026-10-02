package kz.taxi.qtime.api;

import kz.taxi.common.core.money.Money;
import kz.taxi.qtime.api.dto.QtimeDtos;
import kz.taxi.qtime.application.BookingWithNames;
import kz.taxi.qtime.application.CompanyViews;
import kz.taxi.qtime.domain.Slot;
import kz.taxi.qtime.domain.SlotGrid;
import kz.taxi.qtime.domain.SlotUnavailability;
import kz.taxi.qtime.domain.Specialist;
import kz.taxi.qtime.domain.ServiceItem;
import org.springframework.stereotype.Component;

import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Domain -> JSON.
 *
 * <p>A hand-written mapper rather than a reflection-based one: the response shape is the
 * contract with eight verticals, and "why is this field called that" must be answerable
 * by reading twenty lines, not by tracing annotations.
 *
 * <p>Money is emitted in minor units next to its currency, never as a decimal string:
 * the phone formats it, and the platform's rule is that a number a client sees is an
 * integer somebody can add up (see {@code docs/adr/0004-money-in-minor-units.md}).
 */
@Component
public class QtimeMapper {

    private static final DateTimeFormatter DATE = DateTimeFormatter.ISO_LOCAL_DATE;

    public QtimeDtos.CompanySummary toSummary(CompanyViews.Card card) {
        return new QtimeDtos.CompanySummary(
                card.company().getId(),
                card.company().getName(),
                card.company().getCategory().name(),
                card.company().getCity(),
                card.company().getAddress(),
                card.company().getLat(),
                card.company().getLon(),
                card.company().getRatingBp(),
                card.company().getReviewsCount(),
                card.specialistsCount(),
                card.servicesCount(),
                card.minPriceMinor());
    }

    public QtimeDtos.CompanyDetail toDetail(CompanyViews.Profile profile) {
        return new QtimeDtos.CompanyDetail(
                profile.company().getId(),
                profile.company().getName(),
                profile.company().getCategory().name(),
                profile.company().getCity(),
                profile.company().getAddress(),
                profile.company().getLat(),
                profile.company().getLon(),
                profile.company().getRatingBp(),
                profile.company().getReviewsCount(),
                profile.company().getTimeZone(),
                profile.specialists().stream().map(QtimeMapper::toSpecialist).toList(),
                profile.services().stream().map(QtimeMapper::toService).toList());
    }

    public static QtimeDtos.SpecialistView toSpecialist(Specialist specialist) {
        return new QtimeDtos.SpecialistView(
                specialist.getId(),
                specialist.getFullName(),
                specialist.getSpecialization(),
                specialist.getRatingBp(),
                specialist.getExperienceYears());
    }

    public static QtimeDtos.ServiceView toService(ServiceItem service) {
        return new QtimeDtos.ServiceView(
                service.getId(),
                service.getName(),
                service.getDurationMinutes(),
                service.getPriceMinor(),
                service.getCurrency().name());
    }

    public QtimeDtos.SlotsResponse toSlots(SlotGrid grid) {
        List<QtimeDtos.SlotView> slots = grid.slots().stream().map(QtimeMapper::toSlot).toList();
        return new QtimeDtos.SlotsResponse(DATE.format(grid.date()), grid.specialistId(), grid.serviceId(),
                grid.durationMinutes(), grid.timeZone(), slots);
    }

    private static QtimeDtos.SlotView toSlot(Slot slot) {
        return new QtimeDtos.SlotView(slot.startsAt(), slot.endsAt(), slot.available(),
                slot.available() ? null : reasonText(slot.reason()));
    }

    /**
     * Why a cell is not bookable, in the language of the screen.
     *
     * <p>The mockup shows taken cells crossed out with the word "занято", and that word
     * is the answer to the only question a client has about a grey cell. The two
     * structural reasons are phrased from the client's point of view as well: "перерыв"
     * is why 12:30 is unavailable for an hour-and-a-half manicure, and "не хватает
     * времени" is why 19:00 is unavailable for the same service in a salon that closes
     * at 20:00.
     */
    private static String reasonText(SlotUnavailability reason) {
        return switch (reason) {
            case BUSY -> "занято";
            case BREAK -> "перерыв";
            case NOT_ENOUGH_TIME -> "не хватает времени";
        };
    }

    public QtimeDtos.BookingResponse toBooking(BookingWithNames booking) {
        Money price = Money.ofMinor(booking.booking().getPriceMinor(), booking.booking().getCurrency());
        // A company or a service deleted from the catalogue leaves the booking intact (it
        // is history) but nameless; the field is then omitted rather than failing the
        // whole response.
        String companyName = booking.company() == null ? null : booking.company().getName();
        String companyAddress = booking.company() == null ? null : booking.company().getAddress();
        String specialistName = booking.specialist() == null ? null : booking.specialist().getFullName();
        String serviceName = booking.service() == null ? null : booking.service().getName();
        return new QtimeDtos.BookingResponse(
                booking.booking().getId(),
                booking.booking().getCode(),
                booking.booking().getStatus().name(),
                booking.booking().getStartsAt(),
                booking.booking().getEndsAt(),
                booking.booking().getCompanyId(),
                companyName,
                companyAddress,
                booking.booking().getSpecialistId(),
                specialistName,
                booking.booking().getServiceId(),
                serviceName,
                booking.booking().getDurationMinutes(),
                price.minorUnits(),
                price.currency().name(),
                booking.booking().getClientComment(),
                booking.booking().getCancelReason(),
                booking.booking().getCreatedAt());
    }
}
