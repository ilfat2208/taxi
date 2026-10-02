package kz.taxi.order.api;

import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.order.OrderFixtures;
import kz.taxi.order.api.dto.OrderDtos;
import kz.taxi.order.application.SupportAuditService;
import kz.taxi.order.application.SupportOrderService;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Who may call the support endpoints, enforced by {@code @PreAuthorize}.
 *
 * <p>The role rule is the security boundary of this feature: the platform's
 * {@code AuthenticatedUser.canAccess(owner)} already lets {@code SUPPORT} read other
 * people's orders, so the endpoints that expose that must be closed to everybody
 * else — a plain CUSTOMER reading a stranger's order would be a straight data leak.
 *
 * <p>The test runs against a minimal context that mirrors what Boot wires in
 * production: method security enabled ({@code ServletSecurityAutoConfiguration} does
 * that in the service) plus the AOP auto-proxy creator that applies it. No database,
 * no Kafka, no Docker — it stays a unit test.
 */
@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = SupportOrderControllerSecurityTest.MethodSecurityTestConfiguration.class)
class SupportOrderControllerSecurityTest {

    private static final String ORDER_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1T";

    @Configuration
    @EnableMethodSecurity
    @EnableAspectJAutoProxy(proxyTargetClass = true)
    static class MethodSecurityTestConfiguration {

        @Bean
        SupportOrderService supportOrderService() {
            return Mockito.mock(SupportOrderService.class);
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
        SupportOrderController supportOrderController(SupportOrderService support, CurrentUser currentUser) {
            return new SupportOrderController(support, currentUser);
        }

        @Bean
        SupportAuditController supportAuditController(SupportAuditService audit) {
            return new SupportAuditController(audit);
        }
    }

    @Autowired
    private SupportOrderController supportController;
    @Autowired
    private SupportAuditController auditController;
    @Autowired
    private SupportOrderService supportService;
    @Autowired
    private SupportAuditService auditService;
    @Autowired
    private CurrentUser currentUser;

    @BeforeEach
    void actorComesFromTheToken() {
        when(currentUser.requireUserId()).thenReturn("agent-7");
    }

    @Test
    @DisplayName("a plain customer cannot read somebody else's order")
    @WithMockUser(username = "caller-1", roles = "CUSTOMER")
    void aCustomerCannotReachTheSupportReads() {
        assertThatThrownBy(() -> supportController.orderById(ORDER_ID))
                .isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> supportController.list(OrderFixtures.OTHER_USER_ID, null, 0, 20))
                .isInstanceOf(AccessDeniedException.class);

        // Denied before the use case: nothing was read and nothing was audited.
        verify(supportService, never()).orderById(Mockito.anyString(), Mockito.anyString());
    }

    @Test
    @DisplayName("support reads somebody else's order and the use case is called with the token's actor")
    @WithMockUser(username = "agent-7", roles = "SUPPORT")
    void supportReadsSomebodyElsesOrder() {
        when(supportService.orderById(ORDER_ID, "agent-7"))
                .thenReturn(OrderFixtures.response(ORDER_ID, "PENDING_PAYMENT"));

        OrderDtos.OrderResponse response = supportController.orderById(ORDER_ID);

        assertThat(response.orderId()).isEqualTo(ORDER_ID);
        // The actor comes from the security context, never from the request: the
        // audit row must name the person who actually made the call.
        verify(supportService).orderById(ORDER_ID, "agent-7");
    }

    @Test
    @DisplayName("only an admin may read the audit trail")
    @WithMockUser(username = "agent-7", roles = "SUPPORT")
    void theAuditTrailIsAdminOnly() {
        assertThatThrownBy(() -> auditController.find(null, null, 0, 50))
                .isInstanceOf(AccessDeniedException.class);
        verify(auditService, never()).findAudit(Mockito.any(), Mockito.any(), Mockito.anyInt(), Mockito.anyInt());

        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("admin-1", null, "ROLE_ADMIN"));
        when(auditService.findAudit(null, null, 0, 50)).thenReturn(PageResponse.empty(0, 50));

        assertThat(auditController.find(null, null, 0, 50).items()).isEmpty();
    }
}
