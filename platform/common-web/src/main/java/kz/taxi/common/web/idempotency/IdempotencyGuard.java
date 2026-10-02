package kz.taxi.common.web.idempotency;

import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * Makes a mutating use case idempotent.
 *
 * <p>The rule of the platform: <em>every</em> endpoint that moves money or
 * creates an order requires an {@code Idempotency-Key}. Mobile clients retry on
 * flaky networks, users double-tap "Pay", and message brokers redeliver — none
 * of those may ever produce a second transfer.
 *
 * <pre>{@code
 * return idempotencyGuard.execute(key, request, TransferResponse.class,
 *         () -> transferService.transfer(request));
 * }</pre>
 *
 * <p>Outcome matrix for the same key:
 * <table>
 *   <tr><th>state</th><th>same body</th><th>different body</th></tr>
 *   <tr><td>first call</td><td>executes</td><td>executes</td></tr>
 *   <tr><td>in progress</td><td>409, retry later</td><td>409</td></tr>
 *   <tr><td>completed</td><td>200, replayed response</td><td>409 conflict</td></tr>
 * </table>
 */
@Component
@Slf4j
public class IdempotencyGuard {

    private final IdempotencyStore store;
    private final ObjectMapper objectMapper;

    public IdempotencyGuard(IdempotencyStore store, ObjectMapper objectMapper) {
        this.store = store;
        this.objectMapper = objectMapper;
    }

    public <T> IdempotencyOutcome<T> execute(String idempotencyKey,
                                            Object requestBody,
                                            Class<T> responseType,
                                            Supplier<T> action) {
        return execute(idempotencyKey, requestBody, objectMapper.constructType(responseType), action);
    }

    public <T> IdempotencyOutcome<T> execute(String idempotencyKey,
                                            Object requestBody,
                                            JavaType responseType,
                                            Supplier<T> action) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                    "header 'Idempotency-Key' is required for this operation");
        }
        if (TransactionSynchronizationManager.isActualTransactionActive()) {
            // The claim must be visible to concurrent replicas before this
            // transaction commits, otherwise two nodes can both execute.
            log.debug("executing idempotent action inside an active transaction; key={}", idempotencyKey);
        }

        String requestHash = hash(requestBody);
        if (store.tryAcquire(idempotencyKey, requestHash)) {
            try {
                T result = action.get();
                store.complete(idempotencyKey, requestHash, serialize(result));
                return IdempotencyOutcome.fresh(result);
            } catch (RuntimeException failure) {
                store.release(idempotencyKey);
                throw failure;
            }
        }

        IdempotencyStore.StoredResponse stored = store.find(idempotencyKey)
                .orElseThrow(() -> DomainException.of(CommonErrorCode.SERVICE_UNAVAILABLE,
                        "idempotency store lost the key while the request was in flight, please retry"));

        if (!requestHash.equals(stored.requestHash())) {
            throw DomainException.of(CommonErrorCode.IDEMPOTENCY_CONFLICT,
                        "key '{}' was already used with a different request body", idempotencyKey)
                    .withDetail("idempotencyKey", idempotencyKey);
        }

        if (stored.state() == IdempotencyStore.State.IN_PROGRESS) {
            throw DomainException.of(CommonErrorCode.CONFLICT,
                        "a request with key '{}' is still being processed, retry in a moment", idempotencyKey)
                    .withDetail("idempotencyKey", idempotencyKey);
        }

        log.debug("replaying stored response for idempotency key={}", idempotencyKey);
        return IdempotencyOutcome.replayed(deserialize(stored.responseJson(), responseType));
    }

    /** Generates a key for internal (system-initiated) idempotent operations. */
    public static String newKey() {
        return Ulid.nextId();
    }

    private <T> T deserialize(String json, JavaType type) {
        try {
            return objectMapper.readValue(json, type);
        } catch (Exception ex) {
            throw DomainException.of(CommonErrorCode.SERVICE_UNAVAILABLE,
                    "stored response for this idempotency key cannot be read back");
        }
    }

    private String serialize(Object value) {
        if (value == null) {
            return "null";
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            throw new IllegalStateException("cannot serialize idempotent response", ex);
        }
    }

    private String hash(Object requestBody) {
        try {
            String canonical = requestBody == null ? "null" : objectMapper.writeValueAsString(requestBody);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException | com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new IllegalStateException("cannot hash request body", ex);
        }
    }

    /** Reads the key from the request context or fails with a clear message. */
    public static String requireKey() {
        Optional<String> key = IdempotencyContext.optional();
        return key.orElseThrow(() -> DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                "header 'Idempotency-Key' is required for this operation"));
    }
}
