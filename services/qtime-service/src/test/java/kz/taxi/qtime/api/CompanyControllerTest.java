package kz.taxi.qtime.api;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.qtime.QtimeFixtures;
import kz.taxi.qtime.application.CompanyQueryService;
import kz.taxi.qtime.application.CompanyViews;
import kz.taxi.qtime.domain.Company;
import kz.taxi.qtime.domain.QtimeErrorCode;
import kz.taxi.qtime.domain.ServiceItem;
import kz.taxi.qtime.domain.Specialist;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The public catalogue as a client's phone sees it.
 *
 * <p>Two things are checked: that a card carries everything the list screen draws without
 * a second request (counts and the cheapest price, which the phone compares salons by),
 * and that an anonymous caller can read it — the free-window grid is the advertisement,
 * and a login wall in front of it loses the booking.
 */
class CompanyControllerTest {

    private final Company company = QtimeFixtures.company();
    private final Specialist specialist = QtimeFixtures.specialist(company);
    private final ServiceItem service = QtimeFixtures.service(company, 90, 450_000L);

    private CompanyQueryService companies;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        companies = mock(CompanyQueryService.class);
        mockMvc = ApiTestSupport.standalone(new CompanyController(companies, new QtimeMapper()));
    }

    @Test
    @DisplayName("GET /companies returns cards with counts and the cheapest price, no token needed")
    void lists_companies_anonymously() throws Exception {
        when(companies.search(any(), any(), any(), eq(0), eq(20)))
                .thenReturn(PageResponse.of(List.of(new CompanyViews.Card(company, 3L, 5L, 450_000L)),
                        0, 20, 1));

        mockMvc.perform(get("/api/v1/qtime/companies"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].companyId").value(company.getId()))
                .andExpect(jsonPath("$.items[0].name").value("Салон красоты «Лотос»"))
                .andExpect(jsonPath("$.items[0].category").value("BEAUTY"))
                .andExpect(jsonPath("$.items[0].city").value("Шымкент"))
                .andExpect(jsonPath("$.items[0].ratingBp").value(0))
                .andExpect(jsonPath("$.items[0].specialistsCount").value(3))
                .andExpect(jsonPath("$.items[0].servicesCount").value(5))
                .andExpect(jsonPath("$.items[0].minPriceMinor").value(450000))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @DisplayName("filters reach the service as they were sent")
    void passes_filters_through() throws Exception {
        when(companies.search(eq("лотос"), any(), eq("Шымкент"), eq(0), eq(10)))
                .thenReturn(PageResponse.empty(0, 10));

        mockMvc.perform(get("/api/v1/qtime/companies")
                        .param("query", "лотос")
                        .param("category", "BEAUTY")
                        .param("city", "Шымкент")
                        .param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    @DisplayName("an unknown category is a 400, not an empty list")
    void unknown_category_is_rejected() throws Exception {
        mockMvc.perform(get("/api/v1/qtime/companies").param("category", "TAXI"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    @DisplayName("GET /companies/{id} returns the masters, the price list and the company's zone")
    void returns_company_detail() throws Exception {
        when(companies.profile(company.getId()))
                .thenReturn(new CompanyViews.Profile(company, List.of(specialist), List.of(service)));

        mockMvc.perform(get("/api/v1/qtime/companies/{id}", company.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.companyId").value(company.getId()))
                .andExpect(jsonPath("$.timezone").value("Asia/Almaty"))
                .andExpect(jsonPath("$.specialists[0].specialistId").value(specialist.getId()))
                .andExpect(jsonPath("$.specialists[0].name").value("Айгуль Смагулова"))
                .andExpect(jsonPath("$.specialists[0].experienceYears").value(6))
                .andExpect(jsonPath("$.services[0].serviceId").value(service.getId()))
                .andExpect(jsonPath("$.services[0].durationMinutes").value(90))
                .andExpect(jsonPath("$.services[0].priceMinor").value(450000))
                .andExpect(jsonPath("$.services[0].currency").value("KZT"));
    }

    @Test
    @DisplayName("an unknown company is a 404")
    void unknown_company_is_not_found() throws Exception {
        when(companies.profile("01MISSING"))
                .thenThrow(DomainException.of(QtimeErrorCode.COMPANY_NOT_FOUND, "no such company"));

        mockMvc.perform(get("/api/v1/qtime/companies/01MISSING"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("COMPANY_NOT_FOUND"));
    }
}
