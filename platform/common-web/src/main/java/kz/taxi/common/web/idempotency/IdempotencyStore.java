package kz.taxi.common.web.idempotency;

import java.util.Optional;

/**
 * Storage for idempotent request handling.
 *
 * <p>Two-step protocol, deliberately not a single atomic "get or compute",
 * because the compute step calls downstream services and can take seconds:
 * <ol>
 *   <li>{@link #tryAcquire} claims the key (atomic SET NX). The winner executes
 *       the command; everybody else either gets the stored response or a
 *       "still in progress" conflict.</li>
 *   <li>{@link #complete} stores the serialized response for replay; on failure
 *       {@link #release} frees the key so the client may retry.</li>
 * </ol>
 *
 * <p>{@code requestHash} is what makes retries safe <em>and</em> honest: a retry
 * with the same key and the same body replays the original response, while the
 * same key with a different body is a client bug and must be rejected instead of
 * silently applying a second, different payment.
 */
public interface IdempotencyStore {

    enum State {
        IN_PROGRESS,
        COMPLETED
    }

    record StoredResponse(State state, String requestHash, String responseJson) {
    }

    /**
     * Atomically claims {@code key}.
     *
     * @return {@code true} if this caller won the claim and must execute the action,
     *         {@code false} if the key is already claimed or completed
     */
    boolean tryAcquire(String key, String requestHash);

    Optional<StoredResponse> find(String key);

    void complete(String key, String requestHash, String responseJson);

    /** Frees the key after a failure so the client can retry the same request. */
    void release(String key);
}
