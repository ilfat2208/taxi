package kz.taxi.common.web.idempotency;

/** Result of an idempotent execution: the body plus whether it was replayed. */
public record IdempotencyOutcome<T>(T body, boolean replayed) {

    public static <T> IdempotencyOutcome<T> fresh(T body) {
        return new IdempotencyOutcome<>(body, false);
    }

    public static <T> IdempotencyOutcome<T> replayed(T body) {
        return new IdempotencyOutcome<>(body, true);
    }
}
