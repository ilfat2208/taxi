package kz.taxi.account.api;

import kz.taxi.account.application.AccountApplicationService;
import kz.taxi.account.application.AccountLimitService;
import kz.taxi.account.application.AccountLimitsSnapshot;
import kz.taxi.account.application.AccountMapper;
import kz.taxi.account.domain.LimitWindow;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.security.Roles;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The limit endpoints as a client sees them: the route, the shape of the body,
 * and the status a non-operator gets.
 *
 * <p>Authorization is enforced in the application service (that is where the rule
 * lives), so the interesting part here is that a refusal actually surfaces as a
 * problem+json 403 rather than being swallowed by a catch-all into a 500 — a bug
 * this platform has hit before.
 */
class AccountLimitControllerTest {

    private static final Instant NOW = Instant.parse("2025-03-14T10:15:30Z");

    private final AuthenticatedUser operator =
            new AuthenticatedUser("op-1", "+77000000000", "Operator", Set.of(Roles.ADMIN));
    private final AuthenticatedUser customer =
            new AuthenticatedUser("U-1", "+77001234567", "Aisha", Set.of(Roles.CUSTOMER));

    private AccountLimitService limitService;
    private CurrentUser currentUser;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        AccountApplicationService accountService = mock(AccountApplicationService.class);
        limitService = mock(AccountLimitService.class);
        currentUser = mock(CurrentUser.class);
        mockMvc = MockMvcBuilders
                .standaloneSetup(new AccountController(accountService, limitService, new AccountMapper(), currentUser))
                .setControllerAdvice(new GlobalExceptionHandler("https://docs.taxi.local/errors"))
                .build();
    }

    private AccountLimitsSnapshot snapshot() {
        return new AccountLimitsSnapshot("A-1", Currency.KZT, List.of(
                new AccountLimitsSnapshot.WindowLimit(LimitWindow.DAILY, true, 500_000L, 120_000L, 380_000L,
                        LimitWindow.DAILY.startOf(NOW), LimitWindow.DAILY.endOf(NOW), NOW),
                new AccountLimitsSnapshot.WindowLimit(LimitWindow.MONTHLY, false, null, 120_000L, null,
                        LimitWindow.MONTHLY.startOf(NOW), LimitWindow.MONTHLY.endOf(NOW), null)),
                new AccountLimitsSnapshot.Velocity(true, 10, Duration.ofMinutes(5), 3L));
    }

    @Test
    @DisplayName("an operator reads limits and usage for both windows")
    void operator_reads_limits() throws Exception {
        when(currentUser.require()).thenReturn(operator);
        when(limitService.read("A-1", operator)).thenReturn(snapshot());

        mockMvc.perform(get("/api/v1/accounts/A-1/limits"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId").value("A-1"))
                .andExpect(jsonPath("$.currency").value("KZT"))
                .andExpect(jsonPath("$.limits[0].window").value("DAILY"))
                .andExpect(jsonPath("$.limits[0].configured").value(true))
                .andExpect(jsonPath("$.limits[0].outgoingLimitMinor").value(500_000))
                .andExpect(jsonPath("$.limits[0].usedMinor").value(120_000))
                .andExpect(jsonPath("$.limits[0].remainingMinor").value(380_000))
                .andExpect(jsonPath("$.limits[1].window").value("MONTHLY"))
                .andExpect(jsonPath("$.limits[1].configured").value(false))
                .andExpect(jsonPath("$.velocity.maxOperations").value(10))
                .andExpect(jsonPath("$.velocity.window").value("PT5M"));
    }

    @Test
    @DisplayName("an operator sets a limit through PUT")
    void operator_sets_a_limit() throws Exception {
        when(currentUser.require()).thenReturn(operator);
        when(limitService.setLimit(eq("A-1"), eq(LimitWindow.DAILY), eq(250_000L), eq(operator)))
                .thenReturn(snapshot());

        mockMvc.perform(put("/api/v1/accounts/A-1/limits")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"window":"DAILY","outgoingLimitMinor":250000}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.limits[0].window").value("DAILY"));

        verify(limitService).setLimit("A-1", LimitWindow.DAILY, 250_000L, operator);
    }

    @Test
    @DisplayName("a customer gets a 403 problem+json, not a 500 and not the limits")
    void customer_is_forbidden() throws Exception {
        when(currentUser.require()).thenReturn(customer);
        when(limitService.read(any(), any()))
                .thenThrow(DomainException.forbidden("only an operator may read transaction limits"));

        mockMvc.perform(get("/api/v1/accounts/A-1/limits"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));

        verify(limitService, never()).setLimit(any(), any(), anyLong(), any());
    }

    @Test
    @DisplayName("an unknown window in the body is a 400, before any service call")
    void unknown_window_is_rejected_at_the_boundary() throws Exception {
        when(currentUser.require()).thenReturn(operator);

        mockMvc.perform(put("/api/v1/accounts/A-1/limits")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"window":"WEEKLY","outgoingLimitMinor":250000}
                                """))
                .andExpect(status().isBadRequest());

        verify(limitService, never()).setLimit(any(), any(), anyLong(), any());
    }
}
