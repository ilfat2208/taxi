package kz.taxi.payment.domain;

import java.util.Objects;

/**
 * Everything a payment needs before it exists: who owns it, what it moves and how
 * the caller can be identified later.
 *
 * <p>A record rather than a twelve-argument factory: the field list is long and
 * almost entirely {@code String}, so a positional constructor is a bug waiting to
 * happen (swap two ids and the compiler will not notice).
 *
 * @param idempotencyKey the client-supplied {@code Idempotency-Key} — also the
 *                       database's last line of defence against a double payment
 * @param requestHash    hash of the request body, so a replayed key with a
 *                       different body is detectable without the Redis store
 */
public record PaymentIntent(
        PaymentType type,
        String ownerUserId,
        String sourceAccountId,
        String targetAccountId,
        String merchantId,
        String orderId,
        String description,
        String idempotencyKey,
        String requestHash,
        String correlationId) {

    public PaymentIntent {
        Objects.requireNonNull(type, "type must not be null");
        requireText(ownerUserId, "ownerUserId");
        requireText(sourceAccountId, "sourceAccountId");
        requireText(idempotencyKey, "idempotencyKey");
        requireText(requestHash, "requestHash");
        if (type.requiresTargetAccount() && (targetAccountId == null || targetAccountId.isBlank())) {
            throw new IllegalArgumentException("a " + type + " payment needs a target account");
        }
        if (type == PaymentType.MERCHANT_PAYMENT && (orderId == null || orderId.isBlank())) {
            throw new IllegalArgumentException("a merchant payment without an orderId cannot be reconciled");
        }
        if (description != null && description.length() > 255) {
            throw new IllegalArgumentException("description must fit into VARCHAR(255)");
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }
}
