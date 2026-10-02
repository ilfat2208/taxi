package kz.taxi.qtime.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.qtime.api.dto.QtimeDtos;
import kz.taxi.qtime.application.CompanyQueryService;
import kz.taxi.qtime.application.CompanyViews;
import kz.taxi.qtime.domain.CompanyCategory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The public catalogue of companies.
 *
 * <p>Anonymous on purpose, and that is a product decision rather than an oversight: the
 * path "маникюр → сегодня → рядом со мной" ends with a person choosing a salon before
 * they have an account, and a login wall in front of a free-window grid loses the
 * booking. Nothing here is private — a company's name, address and prices are what it
 * publishes — while taking a window is authenticated, and reading somebody else's
 * appointments is not offered at all.
 *
 * <p>Thin by design: no business rules and no status codes invented locally.
 */
@RestController
@RequestMapping("/api/v1/qtime/companies")
@Tag(name = "QTime companies", description = "Salons, СТО, clinics: masters, services and prices")
public class CompanyController {

    private static final int MAX_PAGE_SIZE = 100;

    private final CompanyQueryService companies;
    private final QtimeMapper mapper;

    public CompanyController(CompanyQueryService companies, QtimeMapper mapper) {
        this.companies = companies;
        this.mapper = mapper;
    }

    @GetMapping
    @Operation(summary = "Search companies",
            description = "Active companies only, best rated first. `query` matches the name, `category` and "
                    + "`city` are exact filters. Each card carries the counts and the cheapest price the "
                    + "phone shows without a second request.")
    public PageResponse<QtimeDtos.CompanySummary> search(
            @Parameter(description = "Substring of the company name") @RequestParam(required = false) String query,
            @Parameter(description = "BEAUTY, BARBERSHOP, AUTO, HEALTH or SERVICES")
            @RequestParam(required = false) CompanyCategory category,
            @Parameter(description = "City, case-insensitive") @RequestParam(required = false) String city,
            @Parameter(description = "Zero-based page index") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size, 1..100") @RequestParam(defaultValue = "20") int size) {

        PageResponse<CompanyViews.Card> found = companies.search(query, category, city, page, clamp(size));
        return PageResponse.of(found.items(), found.page(), found.size(), found.totalElements(),
                mapper::toSummary);
    }

    @GetMapping("/{companyId}")
    @Operation(summary = "One company with its specialists and services",
            description = "404 COMPANY_NOT_FOUND for an unknown id. `timezone` is the zone the company's "
                    + "opening hours are written in, so the client can format slot times in the salon's time.")
    public QtimeDtos.CompanyDetail get(@PathVariable String companyId) {
        return mapper.toDetail(companies.profile(companyId));
    }

    private static int clamp(int size) {
        return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    }
}
