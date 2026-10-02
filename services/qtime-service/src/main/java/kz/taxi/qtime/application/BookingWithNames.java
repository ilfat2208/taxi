package kz.taxi.qtime.application;

import kz.taxi.qtime.domain.Booking;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;

/**
 * A booking with the names that go next to it on a screen.
 *
 * <p>The booking table stores ids — a receipt must survive a salon being renamed — but
 * a client reads "Салон «Лотос», Айгуль, маникюр с покрытием", so the read paths load
 * the three referenced rows and hand them along. One shape for the create response and
 * for the list, which is what keeps the two from drifting apart in shape and in cost:
 * the list resolves the page's ids with three queries, not three per row.
 */
public record BookingWithNames(Booking booking, Company company, Specialist specialist, ServiceItem service) {
}
