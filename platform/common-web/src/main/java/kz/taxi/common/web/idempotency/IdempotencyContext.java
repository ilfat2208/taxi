package kz.taxi.common.web.idempotency;

import java.util.Optional;

/** Per-request access to the {@code Idempotency-Key} header. */
public final class IdempotencyContext {

    /** Servlet request attribute populated by the filter, readable from any layer. */
    public static final String ATTRIBUTE = "taxi.idempotencyKey";

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private IdempotencyContext() {
    }

    public static Optional<String> optional() {
        String key = CURRENT.get();
        return key == null || key.isBlank() ? Optional.empty() : Optional.of(key);
    }

    public static void set(String key) {
        CURRENT.set(key);
    }

    public static void clear() {
        CURRENT.remove();
    }
}
