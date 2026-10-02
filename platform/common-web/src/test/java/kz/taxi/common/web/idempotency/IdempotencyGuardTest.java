package kz.taxi.common.web.idempotency;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IdempotencyGuardTest {

    public record TransferRequest(String from, String to, long amountMinor) {
    }

    public record TransferResponse(String paymentId, String status) {
    }

    private IdempotencyGuard guard;

    @BeforeEach
    void setUp() {
        guard = new IdempotencyGuard(
                new InMemoryIdempotencyStore(Duration.ofMinutes(5)),
                new ObjectMapper());
    }

    @Test
    @DisplayName("executes once and replays the stored response on retry")
    void replays_response() {
        TransferRequest request = new TransferRequest("A1", "A2", 150_000);
        AtomicInteger invocations = new AtomicInteger();

        IdempotencyOutcome<TransferResponse> first = guard.execute("key-1", request, TransferResponse.class, () -> {
            invocations.incrementAndGet();
            return new TransferResponse("P-1", "COMPLETED");
        });
        IdempotencyOutcome<TransferResponse> retry = guard.execute("key-1", request, TransferResponse.class, () -> {
            invocations.incrementAndGet();
            return new TransferResponse("P-2", "COMPLETED");
        });

        assertThat(invocations).hasValue(1);
        assertThat(first.replayed()).isFalse();
        assertThat(retry.replayed()).isTrue();
        assertThat(retry.body()).isEqualTo(new TransferResponse("P-1", "COMPLETED"));
    }

    @Test
    @DisplayName("rejects the same key with a different payload instead of charging twice")
    void rejects_key_reuse_with_different_body() {
        guard.execute("key-2", new TransferRequest("A1", "A2", 100), TransferResponse.class,
                () -> new TransferResponse("P-1", "COMPLETED"));

        assertThatThrownBy(() -> guard.execute("key-2", new TransferRequest("A1", "A2", 999_999),
                TransferResponse.class, () -> new TransferResponse("P-2", "COMPLETED")))
                .isInstanceOf(DomainException.class)
                .extracting(ex -> ((DomainException) ex).errorCode())
                .isEqualTo(CommonErrorCode.IDEMPOTENCY_CONFLICT);
    }

    @Test
    @DisplayName("fails the key with a fresh key when the action throws, so the client can retry")
    void releases_key_after_failure() {
        AtomicInteger attempts = new AtomicInteger();

        assertThatThrownBy(() -> guard.execute("key-3", "body", TransferResponse.class, () -> {
            attempts.incrementAndGet();
            throw DomainException.conflict("downstream unavailable");
        })).isInstanceOf(DomainException.class);

        IdempotencyOutcome<TransferResponse> retry = guard.execute("key-3", "body", TransferResponse.class, () -> {
            attempts.incrementAndGet();
            return new TransferResponse("P-3", "COMPLETED");
        });

        assertThat(attempts).hasValue(2);
        assertThat(retry.replayed()).isFalse();
    }

    @Test
    @DisplayName("distinguishes idempotency keys from each other")
    void isolates_keys() {
        guard.execute("key-a", "same-body", TransferResponse.class, () -> new TransferResponse("P-A", "OK"));
        IdempotencyOutcome<TransferResponse> other =
                guard.execute("key-b", "same-body", TransferResponse.class, () -> new TransferResponse("P-B", "OK"));

        assertThat(other.replayed()).isFalse();
        assertThat(other.body().paymentId()).isEqualTo("P-B");
    }

    @Test
    @DisplayName("requires a key for mutating operations")
    void requires_key() {
        assertThatThrownBy(() -> guard.execute("  ", "body", TransferResponse.class, () -> null))
                .isInstanceOf(DomainException.class)
                .hasMessageContaining("Idempotency-Key");
    }

    @Test
    @DisplayName("returns the result unchanged when the response has no stored counterpart")
    void handles_generic_response_types() {
        IdempotencyOutcome<List<String>> outcome = guard.execute("key-generic", "body",
                new ObjectMapper().getTypeFactory().constructCollectionType(List.class, String.class),
                () -> List.of("a", "b"));

        assertThat(outcome.body()).containsExactly("a", "b");
        assertThat(guard.execute("key-generic", "body",
                new ObjectMapper().getTypeFactory().constructCollectionType(List.class, String.class),
                () -> List.of("different")).body()).containsExactly("a", "b");
    }
}
