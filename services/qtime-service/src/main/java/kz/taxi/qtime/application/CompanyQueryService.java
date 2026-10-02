package kz.taxi.qtime.application;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.CompanyCategory;
import kz.taxi.qtime.domain.CompanyStatus;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.infrastructure.CompanyRepository;
import kz.taxi.qtime.infrastructure.ServiceItemRepository;
import kz.taxi.qtime.infrastructure.SpecialistRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.persistence.criteria.Predicate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Browsing: "маникюр → сегодня → рядом со мной" starts with a list of companies.
 *
 * <p>Reads are anonymous — a person decides to register *after* seeing free windows —
 * and the list is served by three queries regardless of page size: one page of
 * companies, one aggregate per company for services and one for specialists. Computing
 * those counts per row would be the classic way a listing endpoint dies under its own
 * weight, and it is also why the counts are not loaded from JPA collections (a lazy
 * {@code @OneToMany} here would be twenty extra queries with no way to see it in a
 * test).
 */
@Service
@Slf4j
public class CompanyQueryService {

    private final CompanyRepository companies;
    private final SpecialistRepository specialists;
    private final ServiceItemRepository services;

    public CompanyQueryService(CompanyRepository companies,
                               SpecialistRepository specialists,
                               ServiceItemRepository services) {
        this.companies = companies;
        this.specialists = specialists;
        this.services = services;
    }

    /** The public list: active companies only, best rated first. */
    @Transactional(readOnly = true)
    public PageResponse<CompanyViews.Card> search(String query, CompanyCategory category, String city,
                                                  int page, int size) {
        Specification<Company> filter = matching(query, category, city);
        // id breaks ties so paging stays stable: without it two companies with the same
        // rating could swap places between page 1 and page 2.
        Sort sort = Sort.by(Sort.Order.desc("ratingBp"), Sort.Order.asc("name"), Sort.Order.asc("id"));
        Page<Company> found = companies.findAll(filter, PageRequest.of(Math.max(page, 0), size));
        List<String> companyIds = found.getContent().stream().map(Company::getId).toList();

        Map<String, Long> specialistCounts = specialists.findByCompanyIdIn(companyIds).stream()
                .collect(Collectors.groupingBy(Specialist::getCompanyId, Collectors.counting()));
        Map<String, ServiceStats> serviceStats = serviceStats(companyIds);

        List<CompanyViews.Card> cards = found.getContent().stream()
                .map(company -> {
                    ServiceStats stats = serviceStats.getOrDefault(company.getId(), ServiceStats.EMPTY);
                    return new CompanyViews.Card(company,
                            specialistCounts.getOrDefault(company.getId(), 0L),
                            stats.count(),
                            stats.minPriceMinor());
                })
                .toList();

        log.debug("company search query={} category={} city={} -> {} of {}",
                query, category, city, cards.size(), found.getTotalElements());
        return PageResponse.of(cards, found.getNumber(), found.getSize(), found.getTotalElements());
    }

    /** The company page: masters and price list, in one round trip each. */
    @Transactional(readOnly = true)
    public CompanyViews.Profile profile(String companyId) {
        Company company = companies.findById(companyId)
                .orElseThrow(() -> DomainException.of(QtimeErrorCode.COMPANY_NOT_FOUND,
                                "company {} not found", companyId)
                        .withDetail("companyId", companyId));
        List<Specialist> masters = specialists.findByCompanyIdOrderByRatingBpDesc(company.getId());
        List<ServiceItem> offers = services.findByCompanyIdOrderByNameAsc(company.getId());
        return new CompanyViews.Profile(company, masters, offers);
    }

    /**
     * Filters, spelled out one predicate at a time.
     *
     * <p>A {@link Specification} rather than a JPQL query with three nullable
     * parameters: what is absent simply produces no predicate, instead of a
     * {@code :param is null} whose type some databases cannot infer — a failure that
     * only appears at runtime, on the request shape nobody happened to test.
     */
    private static Specification<Company> matching(String query, CompanyCategory category, String city) {
        String nameFragment = query == null || query.isBlank() ? null : "%" + query.trim().toLowerCase() + "%";
        String cityName = city == null || city.isBlank() ? null : city.trim().toLowerCase();
        return (root, criteriaQuery, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            // A suspended company is off the marketplace: it keeps its history and its
            // appointments, but a client cannot discover it and ask for a window.
            predicates.add(builder.equal(root.get("status"), CompanyStatus.ACTIVE));
            if (nameFragment != null) {
                predicates.add(builder.like(builder.lower(root.get("name")), nameFragment));
            }
            if (category != null) {
                predicates.add(builder.equal(root.get("category"), category));
            }
            if (cityName != null) {
                predicates.add(builder.equal(builder.lower(root.get("city")), cityName));
            }
            return builder.and(predicates.toArray(Predicate[]::new));
        };
    }

    private Map<String, ServiceStats> serviceStats(List<String> companyIds) {
        if (companyIds.isEmpty()) {
            return Map.of();
        }
        Map<String, ServiceStats> stats = new HashMap<>();
        for (Object[] row : services.statsByCompanyIds(companyIds)) {
            String companyId = (String) row[0];
            long count = ((Number) row[1]).longValue();
            Long minPrice = row[2] == null ? null : ((Number) row[2]).longValue();
            stats.put(companyId, new ServiceStats(count, minPrice));
        }
        return stats;
    }

    private record ServiceStats(long count, Long minPriceMinor) {

        static final ServiceStats EMPTY = new ServiceStats(0L, null);
    }
}
