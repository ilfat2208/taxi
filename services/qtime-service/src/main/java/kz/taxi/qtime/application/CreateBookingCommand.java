package kz.taxi.qtime.application;

import java.time.Instant;

/**
 * The body of "take this window".
 *
 * <p>A command record rather than the HTTP DTO: the controller has already validated
 * the request, and the use case should not depend on the transport's shape (nor on
 * annotations that only mean something to a servlet).
 */
public record CreateBookingCommand(String specialistId, String serviceId, Instant startsAt, String comment) {
}
