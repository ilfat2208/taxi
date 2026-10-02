package kz.taxi.common.core.context;

/**
 * Request-scoped correlation id.
 *
 * <p>One id is minted at the edge (api-gateway or the first filter in a service)
 * and then travels: HTTP header -> MDC -> Kafka record header -> consumer MDC.
 * That is what makes "show me everything that happened to payment X" possible
 * without a distributed debugger.
 */
public final class CorrelationContext {

    public static final String HEADER = "X-Correlation-Id";
    public static final String MDC_KEY = "correlationId";

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private CorrelationContext() {
    }

    public static String get() {
        return CURRENT.get();
    }

    public static void set(String correlationId) {
        CURRENT.set(correlationId);
    }

    public static void clear() {
        CURRENT.remove();
    }

    /** Returns the current id, minting one if this thread has none yet. */
    public static String getOrCreate() {
        String current = CURRENT.get();
        if (current == null || current.isBlank()) {
            current = kz.taxi.common.core.id.Ulid.nextId();
            CURRENT.set(current);
        }
        return current;
    }

    /** Runs the action with the given correlation id, restoring the previous one. */
    public static void runWith(String correlationId, Runnable action) {
        String previous = CURRENT.get();
        try {
            set(correlationId);
            action.run();
        } finally {
            if (previous == null) {
                clear();
            } else {
                set(previous);
            }
        }
    }
}
