package kz.taxi.trip.infrastructure.client;

import kz.taxi.common.core.money.Currency;

import java.time.Instant;
import java.util.Optional;

/**
 * The money side of a ride, as this service needs to see it.
 *
 * <p>An interface, not a class, because the saga is meaningless without a counterpart
 * it can lie about: unit tests have to make a hold fail with {@code INSUFFICIENT_FUNDS}
 * and a capture expire, and neither of those is reproducible against a real account
 * service. The HTTP implementation is {@link HttpRideAccountClient}; nothing in the
 * application layer knows which one it is talking to.
 *
 * <p>Every method is safe to repeat, and that is a requirement rather than a nicety:
 * this saga crashes, redeploys and gets retried. {@code placeHold} is idempotent by
 * {@code idempotencyKey}, {@code capture} returns the original transaction when the
 * hold was already captured, and {@code release} is a no-op for an already released
 * hold.
 *
 * <p>No method takes headers: {@code Authorization}, {@code X-Internal-Token} and
 * {@code X-Correlation-Id} are added by the platform's outbound interceptor on the
 * auto-configured {@code RestClient.Builder}, and setting them here would duplicate
 * that and risk sending a user token where an internal one is required.
 */
public interface RideAccountClient {

    /**
     * Reference type of the fare's reservation.
     *
     * <p>The reference id is the trip id, so the money of a ride is findable from the
     * ride — which is what support needs and what makes the second reservation
     * impossible: the account service allows one ACTIVE hold per
     * {@code (referenceType, referenceId, accountId)}.
     */
    String REFERENCE_TYPE_TRIP = "TRIP";

    /** Resolves the rider's wallet from his phone number: the only handle a token gives us. */
    ResolvedAccount resolveByPhone(String phone, Currency currency);

    /** The active reservation of a trip, if one exists. */
    Optional<HoldView> findActiveHold(String referenceType, String referenceId, String accountId);

    /** Reserves the fare. Idempotent by {@code idempotencyKey}. */
    HoldView placeHold(HoldRequest request);

    /**
     * Turns the reservation into a real charge.
     *
     * <p>Without a target account the money settles to the platform suspense account,
     * which is exactly what a wallet ride does: the rider's fare leaves his wallet and
     * the platform owes the driver his net share (see {@code Trip.driverNetMinor}).
     */
    CaptureView capture(String holdId, CaptureRequest request);

    /** Gives the reserved fare back. Releasing an already released hold is a no-op. */
    void release(String holdId, String reason);

    record ResolvedAccount(String accountId, String ownerUserId, String currency, String status) {
    }

    record HoldView(String holdId,
                    String accountId,
                    long amountMinor,
                    String currency,
                    String status,
                    long availableMinor,
                    Instant expiresAt,
                    boolean replayed) {
    }

    record CaptureView(String holdId,
                       String status,
                       String transactionId,
                       String sourceAccountId,
                       String targetAccountId,
                       long amountMinor,
                       String currency,
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
}
