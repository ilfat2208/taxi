package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.SupportAuditRecordResponse;
import kz.taxi.catalog.domain.SupportAction;
import kz.taxi.catalog.domain.SupportAuditRecord;
import kz.taxi.catalog.infrastructure.SupportAuditRepository;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.web.PageResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.ArgumentMatchers;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The audit trail itself: what a row contains, and what the ADMIN-only read returns.
 *
 * <p>The write is tested through the real {@link SupportAuditService} against a mocked
 * repository, so the row that is asserted here is the row that would be inserted —
 * including the correlation id the request arrived with.
 */
class SupportAuditServiceTest {

    private static final String ACTOR = "agent-7";

    private SupportAuditRepository repository;
    private SupportAuditService service;

    @BeforeEach
    void setUp() {
        repository = mock(SupportAuditRepository.class);
        service = new SupportAuditService(repository);
    }

    @AfterEach
    void tearDown() {
        CorrelationContext.clear();
    }

    @Test
    @DisplayName("a row carries who, what, which resource, when and the request's correlation id")
    void aRowCarriesWhoWhatWhichResourceWhenAndTheCorrelationId() {
        CorrelationContext.set("corr-42");

        service.append(SupportAction.MERCHANT_READ, "merchant-1", ACTOR);

        SupportAuditRecord row = capturedRow();
        assertThat(row.getActorUserId()).isEqualTo(ACTOR);
        assertThat(row.getAction()).isEqualTo("catalog.support.merchant.read");
        assertThat(row.getEndpoint()).isEqualTo("GET /api/v1/support/merchants/{merchantId}");
        assertThat(row.getResourceType()).isEqualTo("MERCHANT");
        assertThat(row.getResourceId()).isEqualTo("merchant-1");
        assertThat(row.getCorrelationId()).isEqualTo("corr-42");
        assertThat(row.getId()).hasSize(26);
        assertThat(row.getCreatedAt()).isNotNull();
    }

    @Test
    @DisplayName("an over-long correlation id is truncated rather than failing the read it describes")
    void anOverLongCorrelationIdIsTruncated() {
        CorrelationContext.set("c".repeat(128));

        service.append(SupportAction.STOCK_READ, "product-1", ACTOR);

        assertThat(capturedRow().getCorrelationId()).hasSize(64);
    }

    @Test
    @DisplayName("the trail is paged newest first, and the page is clamped rather than trusted")
    void theTrailIsPagedNewestFirstAndClamped() {
        SupportAuditRecord row = SupportAuditRecord.of("agent-7", "catalog.support.stock.read",
                "GET /api/v1/support/products/{productId}/stock", "STOCK", "product-1", "corr-9");
        when(repository.findAll(ArgumentMatchers.<Specification<SupportAuditRecord>>any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(row)));

        PageResponse<SupportAuditRecordResponse> page =
                service.findAudit("stock", "product-1", -3, 5_000);

        assertThat(page.items()).singleElement().satisfies(record -> {
            assertThat(record.actorUserId()).isEqualTo("agent-7");
            assertThat(record.action()).isEqualTo("catalog.support.stock.read");
            assertThat(record.resourceType()).isEqualTo("STOCK");
            assertThat(record.resourceId()).isEqualTo("product-1");
            assertThat(record.correlationId()).isEqualTo("corr-9");
        });

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findAll(ArgumentMatchers.<Specification<SupportAuditRecord>>any(), pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isZero();
        assertThat(pageable.getValue().getPageSize()).isEqualTo(200);
        assertThat(pageable.getValue().getSort().getOrderFor("createdAt")).isNotNull();
        assertThat(pageable.getValue().getSort().getOrderFor("createdAt").getDirection())
                .isEqualTo(Sort.Direction.DESC);
    }

    private SupportAuditRecord capturedRow() {
        ArgumentCaptor<SupportAuditRecord> captor = ArgumentCaptor.forClass(SupportAuditRecord.class);
        verify(repository).save(captor.capture());
        return captor.getValue();
    }
}
