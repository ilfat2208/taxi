package kz.taxi.account.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.account.api.dto.InternalAccountDtos;
import kz.taxi.account.application.AccountMapper;
import kz.taxi.account.application.InternalAccountApplicationService;
import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountErrorCode;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-to-service money API.
 *
 * <p>Reached only through the platform's internal-token filter (the path contains
 * {@code /internal/}) and never routed by the public gateway. There is no user
 * token here on purpose: a payment must be able to credit the <em>recipient</em>
 * of a transfer, and the recipient is not the caller — that authority cannot be
 * expressed with user roles.
 */
@RestController
@RequestMapping("/api/v1/accounts/internal")
@Tag(name = "Accounts (internal)", description = "Called by payment-service; protected by X-Internal-Token")
public class InternalAccountController {

    private final InternalAccountApplicationService internalAccounts;
    private final AccountMapper mapper;

    public InternalAccountController(InternalAccountApplicationService internalAccounts, AccountMapper mapper) {
        this.internalAccounts = internalAccounts;
        this.mapper = mapper;
    }

    @PostMapping("/holds")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Reserve funds for an in-flight payment",
            description = "Idempotent by idempotencyKey: a retried request returns the original hold.")
    public InternalAccountDtos.HoldResponse placeHold(@Valid @RequestBody InternalAccountDtos.PlaceHoldRequest request) {
        InternalAccountApplicationService.PlaceHoldResult result = internalAccounts.placeHold(
                request.accountId(), request.amountMinor(), request.currency(),
                request.referenceType(), request.referenceId(), request.idempotencyKey(), request.reason());
        return mapper.toHoldResponse(result.hold(), result.account().availableMinor(), result.replayed());
    }

    @PostMapping("/holds/{holdId}/capture")
    @Operation(summary = "Turn reserved funds into a real movement",
            description = "With targetAccountId the money moves to another account (P2P); without it the "
                    + "money settles to the platform suspense account (merchant payment). Replaying a "
                    + "captured hold returns the original transaction instead of moving money again.")
    public InternalAccountDtos.CaptureHoldResponse capture(@PathVariable String holdId,
                                                           @Valid @RequestBody InternalAccountDtos.CaptureHoldRequest request) {
        InternalAccountApplicationService.CaptureResult result = internalAccounts.captureHold(
                holdId, request.targetAccountId(), request.operation(), request.description());
        AccountHold hold = result.hold();
        return new InternalAccountDtos.CaptureHoldResponse(
                hold.getId(), hold.getStatus().name(), result.transactionId(),
                result.sourceAccountId(), result.targetAccountId(), hold.getAmountMinor(),
                hold.getCurrency().name(), result.replayed());
    }

    @PostMapping("/holds/{holdId}/release")
    @Operation(summary = "Give reserved funds back", description = "Idempotent: releasing twice is safe.")
    public InternalAccountDtos.HoldResponse release(@PathVariable String holdId,
                                                    @RequestBody(required = false) InternalAccountDtos.ReleaseHoldRequest request) {
        AccountHold hold = internalAccounts.releaseHold(holdId, request == null ? null : request.reason());
        Account account = internalAccounts.view(hold.getAccountId());
        return mapper.toHoldResponse(hold, account.availableMinor(), false);
    }

    @PostMapping("/credits")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Credit an account from outside the system",
            description = "Idempotent by (referenceType, referenceId): the same payout reference never pays twice.")
    public InternalAccountDtos.CreditResponse credit(@Valid @RequestBody InternalAccountDtos.CreditRequest request) {
        InternalAccountApplicationService.CreditResult result = internalAccounts.credit(
                request.accountId(), request.amountMinor(), request.currency(),
                request.referenceType(), request.referenceId(), request.operation(), request.description());
        return new InternalAccountDtos.CreditResponse(
                result.account().getId(), result.transactionId(), request.amountMinor(),
                request.currency().name(), result.balanceAfterMinor(), result.replayed());
    }

    @GetMapping("/resolve")
    @Operation(summary = "Find an account by phone number", description = "Used to route P2P transfers.")
    public InternalAccountDtos.ResolveAccountResponse resolve(@RequestParam String phone,
                                                              @RequestParam Currency currency) {
        return mapper.toResolveResponse(internalAccounts.resolveByPhone(phone, currency));
    }

    @GetMapping("/accounts/{accountId}")
    @Operation(summary = "Internal account snapshot, including reserved funds")
    public InternalAccountDtos.InternalAccountView view(@PathVariable String accountId) {
        return mapper.toInternalView(internalAccounts.view(accountId));
    }

    @GetMapping("/holds/{holdId}")
    @Operation(summary = "Read a hold", description = "Lets a recovering saga ask what happened without moving money.")
    public InternalAccountDtos.HoldResponse hold(@PathVariable String holdId) {
        AccountHold hold = internalAccounts.hold(holdId);
        Account account = internalAccounts.view(hold.getAccountId());
        return mapper.toHoldResponse(hold, account.availableMinor(), false);
    }

    @GetMapping("/holds")
    @Operation(summary = "Find the active hold a service created for a business reference")
    public InternalAccountDtos.HoldResponse findHold(@RequestParam String referenceType,
                                                     @RequestParam String referenceId,
                                                     @RequestParam String accountId) {
        AccountHold hold = internalAccounts.findActiveHold(referenceType, referenceId, accountId)
                .orElseThrow(() -> DomainException.of(AccountErrorCode.HOLD_NOT_FOUND,
                        "no active hold for {} {} on account {}", referenceType, referenceId, accountId));
        return mapper.toHoldResponse(hold, internalAccounts.view(accountId).availableMinor(), false);
    }
}
