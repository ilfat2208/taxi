package kz.taxi.qtime.infrastructure;

import kz.taxi.qtime.domain.ServiceItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

/**
 * Services.
 *
 * <p>{@link #statsByCompanyIds} exists so a page of twenty company cards costs three
 * queries instead of sixty: the phone shows "12 мастеров · 24 услуги · от 4 500 ₸" on
 * every card, and computing that per row is the classic way a listing endpoint dies
 * under its own weight.
 *
 * <p>There is deliberately no "services of this specialist" finder yet: the slot grid is
 * asked for one service at a time and the company page lists the whole price list, so a
 * third query shape would be speculative. A specialist's own price list arrives with the
 * ORTA Business calendar, together with its screen.
 */
public interface ServiceItemRepository extends JpaRepository<ServiceItem, String> {

    List<ServiceItem> findByCompanyIdOrderByNameAsc(String companyId);

    /**
     * Per company: how many services it publishes and the cheapest one.
     *
     * <p>The cheapest price is what "от 4 500 ₸" on a card means, and it must come from
     * the offers of that company only — aggregating in SQL keeps pagination honest,
     * because the page of companies is already fixed when these rows are fetched.
     */
    @Query("""
            select s.companyId, count(s), min(s.priceMinor)
              from ServiceItem s
             where s.companyId in :companyIds
             group by s.companyId
            """)
    List<Object[]> statsByCompanyIds(@Param("companyIds") Collection<String> companyIds);
}
