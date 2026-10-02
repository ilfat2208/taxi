package kz.taxi.qtime.application;

import java.time.Instant;

/**
 * Payloads of the events this service publishes to {@code qtime.events}.
 *
 * <p>Flat and self-contained, like {@code DriverEvents}: a consumer builds a
 * notification, a calendar entry or a CRM row from the event alone, without calling
 * back into QTime. That is why the names travel with every event even though the
 * booking table stores only ids — the alternative is a consumer that has to ask "а что
 * это был за салон?" on the happy path, which re-introduces exactly the coupling Kafka
 * exists to remove.
 *
 * <p>One shape for {@code booking.created}, {@code booking.cancelled} and
 * {@code booking.completed}: consumers care about the resulting state, and a class per
 * transition would be three records that drift. The {@code eventType} distinguishes
 * them, and the payload always carries the full booking — a cancelled event that
 * mentioned only the id would force the consumer to keep state.
 *
 * <p>The price is a snapshot, not a live lookup: it is what the client was quoted, and
 * notifications and, later, the payment hold must show the same number the confirmation
 * screen did.
 */
public final class QtimeEvents {

    private QtimeEvents() {
    }

    public record BookingEvent(String bookingId,
                               String code,
                               String status,
                               String clientUserId,
                               String companyId,
                               String companyName,
                               String companyAddress,
                               String city,
                               String specialistId,
                               String specialistName,
                               String serviceId,
                               String serviceName,
                               Instant startsAt,
                               Instant endsAt,
                               int durationMinutes,
                               long priceMinor,
                               String currency,
                               String timeZone,
                               String cancelReason,
                               Instant occurredAt) {

        /** Builds the payload of a booking as it is at {@code occurredAt}. */
        public static BookingEvent of(BookingWithNames booking, Instant occurredAt) {
            return new BookingEvent(
                    booking.booking().getId(),
                    booking.booking().getCode(),
                    booking.booking().getStatus().name(),
                    booking.booking().getClientUserId(),
                    booking.company().getId(),
                    booking.company().getName(),
                    booking.company().getAddress(),
                    booking.company().getCity(),
                    booking.specialist().getId(),
                    booking.specialist().getFullName(),
                    booking.service().getId(),
                    booking.service().getName(),
                    booking.booking().getStartsAt(),
                    booking.booking().getEndsAt(),
                    booking.booking().getDurationMinutes(),
                    booking.booking().getPriceMinor(),
                    booking.booking().getCurrency().name(),
                    booking.company().getTimeZone(),
                    booking.booking().getCancelReason(),
                    occurredAt);
        }
    }
}
