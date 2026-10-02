package kz.taxi.trip.infrastructure;

import kz.taxi.trip.domain.Quote;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Price promises.
 *
 * <p>No finder for "the rider's quotes": nothing shows a list of them, and a query
 * nobody needs is a query that will be misused later. Expired rows are left to a
 * retention job — a quote is the evidence of the price a rider agreed to, so deleting
 * it while the trip it produced is still alive would be losing the receipt's source.
 */
public interface QuoteRepository extends JpaRepository<Quote, String> {
}
