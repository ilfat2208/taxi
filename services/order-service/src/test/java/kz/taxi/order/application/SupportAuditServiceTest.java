package kz.taxi.order.application;

import kz.taxi.common.core.web.PageResponse;
import kz.taxi.order.api.dto.SupportAuditRecordResponse;
import kz.taxi.order.domain.SupportAuditRecord;
import kz.taxi.order.infrastructure.SupportAuditRepository;
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
 * The ADMIN-only read side of the audit trail: the log must be queryable, or it is
 * write-only and proves nothing to the customer who asks who looked at their orders.
 */
class SupportAuditServiceTest {

    private SupportAuditRepository repository;
    private SupportAuditService service;

    @BeforeEach
    void setUp() {
        repository = mock(SupportAuditRepository.class);
        service = new SupportAuditService(repository);
    }

    @Test
    @DisplayName("the trail is paged newest first, and the page is clamped rather than trusted")
    void theTrailIsPagedNewestFirstAndClamped() {
        SupportAuditRecord row = SupportAuditRecord.of("agent-7", "order.support.order.read",
                "GET /api/v1/support/orders/{orderId}", "ORDER", "order-1", "corr-9");
        when(repository.findAll(ArgumentMatchers.<Specification<SupportAuditRecord>>any(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(row)));

        PageResponse<SupportAuditRecordResponse> page = service.findAudit("order", "order-1", -1, 100_000);

        assertThat(page.items()).singleElement().satisfies(record -> {
            assertThat(record.actorUserId()).isEqualTo("agent-7");
            assertThat(record.action()).isEqualTo("order.support.order.read");
            assertThat(record.endpoint()).isEqualTo("GET /api/v1/support/orders/{orderId}");
            assertThat(record.resourceType()).isEqualTo("ORDER");
            assertThat(record.resourceId()).isEqualTo("order-1");
            assertThat(record.correlationId()).isEqualTo("corr-9");
            assertThat(record.createdAt()).isNotNull();
        });

        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findAll(ArgumentMatchers.<Specification<SupportAuditRecord>>any(), pageable.capture());
        assertThat(pageable.getValue().getPageNumber()).isZero();
        assertThat(pageable.getValue().getPageSize()).isEqualTo(200);
        assertThat(pageable.getValue().getSort().getOrderFor("createdAt").getDirection())
                .isEqualTo(Sort.Direction.DESC);
    }
}
