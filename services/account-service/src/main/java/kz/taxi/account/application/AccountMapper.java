package kz.taxi.account.application;

import kz.taxi.account.api.dto.AccountDtos;
import kz.taxi.account.api.dto.InternalAccountDtos;import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountHold;
import kz.taxi.account.domain.LedgerEntry;
import org.springframework.stereotype.Component;

/**
 * Entity to DTO mapping.
 *
 * <p>Deliberately hand-written and explicit: a mapping library would hide the one
 * thing a payments API must never hide — exactly which fields leave the service.
 * Internal state (version, suspense flags, owner ids of other users) is never
 * exposed by accident because every field is listed here.
 */
@Component
public class AccountMapper {

    public AccountDtos.AccountResponse toResponse(Account account) {
        return new AccountDtos.AccountResponse(
                account.getId(),
                account.getOwnerUserId(),
                account.getOwnerPhone(),
                account.getDisplayName(),
                account.getType().name(),
                account.getCurrency().name(),
                account.getStatus().name(),
                account.getBalanceMinor(),
                account.getHeldMinor(),
                account.availableMinor(),
                account.getCreatedAt(),
                account.getUpdatedAt());
    }

    public AccountDtos.LedgerEntryResponse toResponse(LedgerEntry entry) {
        return new AccountDtos.LedgerEntryResponse(
                entry.getId(),
                entry.getTransactionId(),
                entry.getAccountId(),
                entry.getDirection().name(),
                entry.getAmountMinor(),
                entry.getCurrency().name(),
                entry.getBalanceAfterMinor(),
                entry.getOperation().name(),
                entry.getReferenceType(),
                entry.getReferenceId(),
                entry.getDescription(),
                entry.getCreatedAt());
    }

    public AccountDtos.HoldView toView(AccountHold hold) {
        return new AccountDtos.HoldView(
                hold.getId(),
                hold.getAccountId(),
                hold.getAmountMinor(),
                hold.getCurrency().name(),
                hold.getStatus().name(),
                hold.getReferenceType(),
                hold.getReferenceId(),
                hold.getReason(),
                hold.getExpiresAt(),
                hold.getCreatedAt());
    }

    public InternalAccountDtos.HoldResponse toHoldResponse(AccountHold hold, long availableMinor, boolean replayed) {
        return new InternalAccountDtos.HoldResponse(
                hold.getId(),
                hold.getAccountId(),
                hold.getAmountMinor(),
                hold.getCurrency().name(),
                hold.getStatus().name(),
                availableMinor,
                hold.getCreatedAt(),
                hold.getExpiresAt(),
                replayed);
    }

    public InternalAccountDtos.InternalAccountView toInternalView(Account account) {
        return new InternalAccountDtos.InternalAccountView(
                account.getId(),
                account.getOwnerUserId(),
                account.getOwnerPhone(),
                account.getCurrency().name(),
                account.getStatus().name(),
                account.getBalanceMinor(),
                account.getHeldMinor(),
                account.availableMinor());
    }

    public InternalAccountDtos.ResolveAccountResponse toResolveResponse(Account account) {
        return new InternalAccountDtos.ResolveAccountResponse(
                account.getId(),
                account.getOwnerUserId(),
                account.getCurrency().name(),
                account.getStatus().name());
    }

    /**
     * Limits plus their usage.
     *
     * <p>{@code usedMinor} is reported in the window even when no limit exists: an
     * operator about to configure a limit needs to see what the account has already
     * committed today, otherwise the first limit they set refuses a payment the
     * customer already made.
     */
    public AccountDtos.LimitsResponse toResponse(AccountLimitsSnapshot snapshot) {
        return new AccountDtos.LimitsResponse(
                snapshot.accountId(),
                snapshot.currency().name(),
                snapshot.limits().stream().map(AccountMapper::toResponse).toList(),
                new AccountDtos.VelocityView(
                        snapshot.velocity().enabled(),
                        snapshot.velocity().maxOperations(),
                        snapshot.velocity().window().toString(),
                        snapshot.velocity().operationsInWindow()));
    }

    private static AccountDtos.LimitView toResponse(AccountLimitsSnapshot.WindowLimit limit) {
        return new AccountDtos.LimitView(
                limit.window().name(),
                limit.configured(),
                limit.outgoingLimitMinor(),
                limit.usedMinor(),
                limit.remainingMinor(),
                limit.windowStart(),
                limit.windowEnd(),
                limit.updatedAt());
    }
}
