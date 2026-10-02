package kz.taxi.catalog.api;

import kz.taxi.catalog.api.dto.SupportMerchantResponse;
import kz.taxi.catalog.application.SupportAuditService;
import kz.taxi.catalog.application.SupportCatalogService;
import kz.taxi.catalog.domain.MerchantStatus;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.CurrentUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who may call the support endpoints, enforced by {@code @PreAuthorize}.
 *
 * <p>The role rule is the security boundary of this feature: the platform's
 * {@code AuthenticatedUser.canAccess(owner)} already lets {@code SUPPORT} see other
 * people's data, so the endpoints that expose it must be closed to everybody else —
 * a plain CUSTOMER reading a stranger's shop would be a straight data leak.
 *
 * <p>The test runs against a minimal context that mirrors what Boot wires in
 * production: method security enabled ({@code ServletSecurityAutoConfiguration} does
 * that in the service) plus the AOP auto-proxy creator that applies it. It needs no
 * database, no Kafka and no Docker, so it stays a unit test.
 */
@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = SupportCatalogControllerSecurityTest.MethodSecurityTestConfiguration.class)
class SupportCatalogControllerSecurityTest {

    private static final String MERCHANT_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1V";

    @Configuration
    @EnableMethodSecurity
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    static class MethodSecurityTestConfiguration {

        @Bean
        SupportCatalogService supportCatalogService() {
            return Mockito.mock(SupportCatalogService.class);
        }

        @Bean
        SupportAuditService supportAuditService() {
            return Mockito.mock(SupportAuditService.class);
        }

        @Bean
        CurrentUser currentUser() {
            return Mockito.mock(CurrentUser.class);
        }

        @Bean
        SupportCatalogController supportCatalogController(SupportCatalogService support, CurrentUser currentUser) {
            return new SupportCatalogController(support, currentUser);
        }

        @Bean
        SupportAuditController supportAuditController(SupportAuditService audit) {
            return new SupportAuditController(audit);
        }
    }

    @Autowired
    private SupportCatalogController supportController;
    @Autowired
    private SupportAuditController auditController;
    @Autowired
    private SupportCatalogService supportService;
    @Autowired
    private SupportAuditService auditService;
    @Autowired
    private CurrentUser currentUser;

    @BeforeEach
    void actorComesFromTheToken() {
        when(currentUser.requireUserId()).thenReturn("agent-7");
    }

    @Test
    @DisplayName("a plain customer cannot read somebody else's merchant data")
    @WithMockUser(username = "caller-1", roles = "CUSTOMER")
    void aCustomerCannotReachTheSupportReads() {
        assertThatThrownBy(() -> supportController.merchantById(MERCHANT_ID))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> supportController.product("product-1"))
                .isInstanceOf(AccessDeniedException.class);

        // Denied before the use case: nothing was read and nothing was audited.
        verify(supportService, never()).merchantById(Mockito.anyString(), Mockito.anyString());
    }

    @Test
    @DisplayName("support reads somebody else's merchant and the use case is called with the token's actor")
    @WithMockUser(username = "agent-7", roles = "SUPPORT")
    void supportReadsSomebodyElsesMerchant() {
        when(supportService.merchantById(MERCHANT_ID, "agent-7")).thenReturn(
                new SupportMerchantResponse(MERCHANT_ID, "user-9", "TechnoMart", "TechnoMart Store",
                        "+77000000000", "shop@example.com", "Алматы", MerchantStatus.ACTIVE, 0, null, 2L,
                        Instant.now()));

        SupportMerchantResponse response = supportController.merchantById(MERCHANT_ID);

        assertThat(response.ownerUserId()).isEqualTo("user-9");
        // The actor is taken from the security context, never from the request: the
        // audit row must name the person who actually made the call.
        verify(supportService).merchantById(MERCHANT_ID, "agent-7");
    }

    @Test
    @DisplayName("only an admin may read the audit trail")
    @WithMockUser(username = "agent-7", roles = "SUPPORT")
    void theAuditTrailIsAdminOnly() {
        assertThatThrownBy(() -> auditController.find(null, null, null, null, null, 0, 50))
                .isInstanceOf(AccessDeniedException.class);
        verify(auditService, never()).findAudit(Mockito.any(), Mockito.any(), Mockito.any(), Mockito.any(), Mockito.any(), Mockito.anyInt(), Mockito.anyInt());

        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("admin-1", null, "ROLE_ADMIN"));
        when(auditService.findAudit(null, null, null, null, null, 0, 50)).thenReturn(PageResponse.empty(0, 50));

        assertThat(auditController.find(null, null, null, null, null, 0, 50).items()).isEmpty();
    }
}
