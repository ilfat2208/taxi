package kz.taxi.qtime.application;

import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;

import java.util.List;

/**
 * Read models of the public company API.
 *
 * <p>Shaped after the phone screens, not after the tables: the card in the list needs
 * "12 мастеров · 24 услуги · от 4 500 ₸" (three numbers the client uses to choose) and
 * the company page needs the masters and the price list.
 *
 * <p>{@code minPriceMinor} is nullable on purpose: a company that has not published a
 * single service yet is a real state (a freshly onboarded salon), and a card that
 * shows "от 0 ₸" because of a {@code null} would be a lie about money.
 */
public final class CompanyViews {

    private CompanyViews() {
    }

    /** One row of the list: the company plus the counts a client compares by. */
    public record Card(Company company, long specialistsCount, long servicesCount, Long minPriceMinor) {
    }

    /** The company page: the company, its masters and its price list. */
    public record Profile(Company company, List<Specialist> specialists, List<ServiceItem> services) {

        public Profile {
            specialists = List.copyOf(specialists);
            services = List.copyOf(services);
        }
    }
}
