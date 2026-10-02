package kz.taxi.qtime.api.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import kz.taxi.qtime.domain.BookingStatus;
import kz.taxi.qtime.domain.CompanyCategory;

import java.time.Instant;
import java.util.List;

/**
 * Request and response bodies of the QTime API.
 *
 * <p>Records with validation annotations, and no domain type leaking into the transport
 * layer except the two enums a client must actually choose from: the category to filter
 * by and the status to filter by. Everything else — money, windows, durations — is
 * flattened into the shape the phone screens read, because that shape is the contract
 * and it must not change every time an entity gains a field.
 *
 * <p>{@code reason} in a slot is a human-readable phrase rather than an enum: the grid
 * shows it next to a greyed-out cell ("занято", "перерыв"), and the platform's rule is
 * that machine decisions use codes while a string a person reads is written for a
 * person. The codes stay available in the problem details of a refused booking.
 */
public final class QtimeDtos {

    private QtimeDtos() {
    }

    // ------------------------------------------------------------------ companies

    /** One card in the list: "12 мастеров · 24 услуги · от 4 500 ₸". */
    public record CompanySummary(String companyId,
                                 String name,
                                 String category,
                                 String city,
                                 String address,
                                 double lat,
                                 double lon,
                                 int ratingBp,
                                 int reviewsCount,
                                 long specialistsCount,
                                 long servicesCount,
                                 Long minPriceMinor) {
    }

    public record SpecialistView(String specialistId,
                                 String name,
                                 String specialization,
                                 int ratingBp,
                                 int experienceYears) {
    }

    public record ServiceView(String serviceId,
                              String name,
                              int durationMinutes,
                              long priceMinor,
                              String currency) {
    }

    public record CompanyDetail(String companyId,
                                String name,
                                String category,
                                String city,
                                String address,
                                double lat,
                                double lon,
                                int ratingBp,
                                int reviewsCount,
                                String timezone,
                                List<SpecialistView> specialists,
                                List<ServiceView> services) {
    }

    // ------------------------------------------------------------------ slots

    public record SlotView(Instant startsAt, Instant endsAt, boolean available, String reason) {
    }

    /**
     * The grid of one day.
     *
     * <p>Carries the zone next to the cells: the instants are absolute and the client is
     * free to format them in whatever zone it likes, but "свободно в 15:30" is only a
     * meaningful sentence in the salon's own time.
     */
    public record SlotsResponse(String date,
                                String specialistId,
                                String serviceId,
                                int durationMinutes,
                                String timezone,
                                List<SlotView> slots) {
    }

    // ------------------------------------------------------------------ bookings

    public record CreateBookingRequest(
            @NotNull @Size(max = 26) String specialistId,
            @NotNull @Size(max = 26) String serviceId,
            @NotNull Instant startsAt,
            @Size(max = 500) String comment) {
    }

    public record CancelBookingRequest(@Size(max = 255) String reason) {
    }

    public record BookingResponse(String bookingId,
                                  String code,
                                  String status,
                                  Instant startsAt,
                                  Instant endsAt,
                                  String companyId,
                                  String companyName,
                                  String companyAddress,
                                  String specialistId,
                                  String specialistName,
                                  String serviceId,
                                  String serviceName,
                                  int durationMinutes,
                                  long priceMinor,
                                  String currency,
                                  String clientComment,
                                  String cancelReason,
                                  Instant createdAt) {
    }
}
