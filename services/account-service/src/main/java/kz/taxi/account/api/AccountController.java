package kz.taxi.account.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.account.api.dto.AccountDtos;
import kz.taxi.account.application.AccountApplicationService;
import kz.taxi.account.application.AccountLimitService;
import kz.taxi.account.application.AccountMapper;
import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.HoldStatus;
import kz.taxi.account.domain.LedgerEntry;
import kz.taxi.common.core.web.PageResponse;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Customer-facing account API.
 *
 * <p>Thin on purpose: no business rules, no transaction boundary, no status codes
 * invented locally. Authorization is decided by the application service, which is
 * the only place that knows who owns an account.
 */
@RestController
@RequestMapping("/api/v1/accounts")
@Tag(name = "Accounts", description = "Wallets, balances and the ledger behind them")
public class AccountController {

    private static final int MAX_PAGE_SIZE = 100;

    private final AccountApplicationService accountService;
    private final AccountLimitService limitService;
    private final AccountMapper mapper;
    private final CurrentUser currentUser;

    public AccountController(AccountApplicationService accountService,
                             AccountLimitService limitService,
                             AccountMapper mapper,
                             CurrentUser currentUser) {
        this.accountService = accountService;
        this.limitService = limitService;
        this.mapper = mapper;
        this.currentUser = currentUser;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Open an account",
            description = "One account per (user, currency, type). SYSTEM accounts cannot be created through the API.")
    public AccountDtos.AccountResponse create(@Valid @RequestBody AccountDtos.CreateAccountRequest request) {
        AuthenticatedUser user = currentUser.require();
        String displayName = request.displayName() == null || request.displayName().isBlank()
                ? user.displayName()
                : request.displayName();
        Account account = accountService.createAccount(user.userId(), user.phone(), displayName,
                request.currency(), request.type());
        return mapper.toResponse(account);
    }

    @GetMapping
    @Operation(summary = "List the caller's accounts")
    public List<AccountDtos.AccountResponse> list() {
        return accountService.listAccounts(currentUser.requireUserId()).stream()
                .map(mapper::toResponse)
                .toList();
    }

    @GetMapping("/{accountId}")
    @Operation(summary = "Get one account", description = "Owner or operator only; anyone else gets 403.")
    public AccountDtos.AccountResponse get(@PathVariable String accountId) {
        return mapper.toResponse(accountService.getAccount(accountId, currentUser.require()));
    }

    @GetMapping("/{accountId}/transactions")
    @Operation(summary = "Ledger statement for an account, newest first")
    public PageResponse<AccountDtos.LedgerEntryResponse> transactions(
            @PathVariable String accountId,
            @Parameter(description = "Zero-based page index") @RequestParam(defaultValue = "0") int page,
            @Parameter(description = "Page size, 1..100") @RequestParam(defaultValue = "20") int size) {

        Pageable pageable = PageRequest.of(Math.max(page, 0), clamp(size));
        Page<LedgerEntry> result = accountService.transactions(accountId, currentUser.require(), pageable);
        return PageResponse.of(result.getContent(), result.getNumber(), result.getSize(),
                result.getTotalElements(), mapper::toResponse);
    }

    @GetMapping("/{accountId}/holds")
    @Operation(summary = "Funds currently reserved for in-flight payments")
    public PageResponse<AccountDtos.HoldView> holds(
            @PathVariable String accountId,
            @RequestParam(required = false) HoldStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {

        Pageable pageable = PageRequest.of(Math.max(page, 0), clamp(size));
        Page<AccountHold> result = accountService.holds(accountId, status, currentUser.require(), pageable);
        return PageResponse.of(result.getContent(), result.getNumber(), result.getSize(),
                result.getTotalElements(), mapper::toView);
    }

    @PostMapping("/{accountId}/top-up")
    @Operation(summary = "Add demo funds (operator only)",
            description = "Creates money from outside the system; the counter-entry is posted to the "
                    + "platform suspense account so the ledger stays balanced.")
    public AccountDtos.AccountResponse topUp(@PathVariable String accountId,
                                             @Valid @RequestBody AccountDtos.TopUpRequest request) {
        return mapper.toResponse(accountService.topUp(accountId, request.amountMinor(), request.reason(),
                currentUser.require()));
    }

    // ------------------------------------------------------------------ limits (operator only)

    @GetMapping("/{accountId}/limits")
    @Operation(summary = "Read an account's transaction limits and their usage (operator only)",
            description = "Returns every window the service enforces. A window without a configured limit is "
                    + "reported as unlimited, together with the value already committed in it. ADMIN role only: "
                    + "transaction limits are fraud-control data, not customer data.")
    public AccountDtos.LimitsResponse limits(@PathVariable String accountId) {
        return mapper.toResponse(limitService.read(accountId, currentUser.require()));
    }

    @PutMapping("/{accountId}/limits")
    @Operation(summary = "Set or change an outgoing limit for one window (operator only)",
            description = "Upsert by window (DAILY or MONTHLY). The currency is taken from the account. "
                    + "No Idempotency-Key is required: the request is declarative, so replaying it cannot "
                    + "move money or duplicate an effect. Lowering a limit never touches funds that are "
                    + "already reserved; it only refuses new outgoing operations.")
    public AccountDtos.LimitsResponse setLimit(@PathVariable String accountId,
                                               @Valid @RequestBody AccountDtos.SetLimitRequest request) {
        return mapper.toResponse(limitService.setLimit(accountId, request.window(),
                request.outgoingLimitMinor(), currentUser.require()));
    }

    private static int clamp(int size) {
        return Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
    }
}
