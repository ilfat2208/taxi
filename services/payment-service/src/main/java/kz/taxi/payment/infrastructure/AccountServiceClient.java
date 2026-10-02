package kz.taxi.payment.infrastructure;

import kz.taxi.common.core.money.Currency;

import java.time.Instant;
import java.util.Optional;

/**
 * The account service, as this service needs to see it.
 *
 * <p>An interface, not a class, because payment-service is nothing without a
 * counterpart it can lie about: unit tests need to make a capture fail after a
 * successful hold, and the integration test needs to run the whole schema and saga
 * without a second service. The HTTP implementation lives in
 * {@link HttpAccountServiceClient}; nothing in the application layer knows which
 * one it is talking to.
 *
 * <p>No method takes headers: {@code Authorization}, {@code X-Internal-Token} and
 * {@code X-Correlation-Id} are added by the platform's outbound interceptor to
 * every call made through the auto-configured {@code RestClient.Builder}, and
 * adding them here would both duplicate that and risk sending a user token where
 * an internal token is required.
 */
public interface AccountServiceClient {

    /** Reference type used for the hold of a payment: the reference id is the payment id. */
    String REFERENCE_TYPE_PAYMENT = "PAYMENT";

    /** Reference type used for a refund credit: the reference id is the refund id. */
    String REFERENCE_TYPE_REFUND = "REFUND";

    /** Reads an account through the public endpoint, so the caller's own token decides access. */
    AccountSnapshot getAccount(String accountId);

    /** Finds the active account of a phone number: the only way to address a recipient. */
    ResolvedAccount resolveByPhone(String phone, Currency currency);

    /** The active hold a payment created, if any: how a recovering saga learns whether funds are reserved. */
    Optional<HoldSnapshot> findActiveHold(String referenceType, String referenceId, String accountId);

    /** A hold by id, whatever its status. */
    Optional<HoldSnapshot> findHold(String holdId);

    /** Reserves funds. Idempotent by {@code idempotencyKey}. */
    HoldSnapshot placeHold(HoldRequest request);

    /** Turns a reservation into a movement. Replaying a captured hold returns its original transaction. */
    CaptureResult capture(String holdId, CaptureRequest request);

    /** Gives reserved funds back. Releasing an already released hold is a no-op. */
    void release(String holdId, String reason);

    /** Credits an account from outside. Idempotent by {@code (referenceType, referenceId)}. */
    CreditResult credit(CreditRequest request);

    /** What the account service knows about the account behind a payment. */
    record AccountSnapshot(String accountId,
                           String ownerUserId,
                           String ownerPhone,
                           String currency,
                           String status,
                           long balanceMinor,
                           long heldMinor,
                           long availableMinor) {
    }

    record ResolvedAccount(String accountId, String ownerUserId, String currency, String status) {
    }

    /** A hold and its status — the single fact that decides a stuck payment's fate. */
    record HoldSnapshot(String holdId,
                        String accountId,
                        long amountMinor,
                        String currency,
                        String status,
                        long availableMinor,
                        Instant expiresAt,
                        boolean replayed) {

        public HoldState state() {
            return HoldState.of(status);
        }
    }

    /** Hold statuses as the account service names them, plus the "unknown" case. */
    enum HoldState {

        ACTIVE, CAPTURED, RELEASED, EXPIRED, UNKNOWN;

        public static HoldState of(String raw) {
            if (raw == null || raw.isBlank()) {
                return UNKNOWN;
            }
            for (HoldState state : values()) {
                if (state.name().equalsIgnoreCase(raw.trim())) {
                    return state;
                }
            }
            return UNKNOWN;
        }
    }

    record CaptureResult(String holdId,
                         String status,
                         String transactionId,
                         String sourceAccountId,
                         String targetAccountId,
                         long amountMinor,
                         String currency,
                         boolean replayed) {
    }

    record CreditResult(String accountId,
                        String transactionId,
                        long amountMinor,
                        String currency,
                        long balanceAfterMinor,
                        boolean replayed) {
    }

    record HoldRequest(String accountId,
                       long amountMinor,
                       Currency currency,
                       String referenceType,
                       String referenceId,
                       String idempotencyKey,
                       String reason) {
    }

    record CaptureRequest(String targetAccountId,
                          String referenceType,
                          String referenceId,
                          String operation,
                          String description) {
    }

    record CreditRequest(String accountId,
                         long amountMinor,
                         Currency currency,
                         String referenceType,
                         String referenceId,
                         String operation,
                         String description) {
    }
}
