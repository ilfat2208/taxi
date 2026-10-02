package kz.taxi.account.application;

import java.time.Instant;

/**
 * Payloads of the events this service publishes to {@code account.events}.
 *
 * <p>They are flat, self-contained and carry amounts in minor units: a consumer
 * must be able to react without calling back into this service, because that call
 * would re-introduce the coupling Kafka exists to remove.
 */
public final class AccountEvents {

    private AccountEvents() {
    }

    public record AccountCreated(String accountId,
                                 String ownerUserId,
                                 String type,
                                 String currency,
                                 String status,
                                 Instant occurredAt) {
    }

    public record BalanceChanged(String accountId,
                                 String transactionId,
                                 long balanceMinor,
                                 long heldMinor,
                                 long availableMinor,
                                 String currency,
                                 String operation,
                                 String referenceType,
                                 String referenceId,
                                 Instant occurredAt) {
    }

    public record HoldChanged(String holdId,
                              String accountId,
                              long amountMinor,
                              String currency,
                              String status,
                              String referenceType,
                              String referenceId,
                              Instant occurredAt) {
    }
}
