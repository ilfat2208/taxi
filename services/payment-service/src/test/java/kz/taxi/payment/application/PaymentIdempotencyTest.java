package kz.taxi.payment.application;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyOutcome;
import kz.taxi.common.web.idempotency.IdempotencyStore;
import kz.taxi.common.web.idempotency.InMemoryIdempotencyStore;
import kz.taxi.payment.api.dto.PaymentDtos;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Idempotency of the mutating endpoints, at the point where it is enforced.
 *
 * <p>A mobile client retries on a flaky network; the customer taps "Pay" twice.
 * The property that must hold is not "the response looks the same" but "the money
 * moved once": the action behind the key has to run exactly once, and a key reused
 * with a different body has to be refused rather than silently executed.
 */
class PaymentIdempotencyTest {

    private IdempotencyGuard guard;
    private AtomicInteger executions;

    @BeforeEach
    void setUp() {
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());
        IdempotencyStore store = new InMemoryIdempotencyStore(Duration.ofHours(1));
        guard = new IdempotencyGuard(store, objectMapper);
        executions = new AtomicInteger();
    }

    private PaymentDtos.PaymentResponse response(String id) {
        return new PaymentDtos.PaymentResponse(id, "P" + id, "P2P_TRANSFER", "COMPLETED", "U-1", "A-1", "A-2",
                null, null, 100_000, 0, 100_000, "KZT", "lunch", null, null,
                Instant.parse("2024-09-01T10:00:00Z"), Instant.parse("2024-09-01T10:00:01Z"),
                Instant.parse("2024-09-01T10:00:01Z"));
    }

    private PaymentDtos.TransferRequest request(long amountMinor) {
        return new PaymentDtos.TransferRequest("A-1", "+77001112233", null, amountMinor,
                kz.taxi.common.core.money.Currency.KZT, "lunch");
    }

    @Test
    @DisplayName("the same key and the same body executes once and replays the stored response")
    void same_key_and_body_replays_the_stored_response() {
        IdempotencyOutcome<PaymentDtos.PaymentResponse> first = guard.execute("key-1", request(100_000),
                PaymentDtos.PaymentResponse.class, () -> {
                    executions.incrementAndGet();
                    return response("P1");
                });
        IdempotencyOutcome<PaymentDtos.PaymentResponse> second = guard.execute("key-1", request(100_000),
                PaymentDtos.PaymentResponse.class, () -> {
                    executions.incrementAndGet();
                    return response("P2");
                });

        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(second.body()).isEqualTo(first.body());
        assertThat(second.body().paymentId()).isEqualTo("P1");
        assertThat(executions.get()).as("the payment must be created once").isEqualTo(1);
    }

    @Test
    @DisplayName("the same key with a different body is a client error, not a second payment")
    void same_key_with_a_different_body_is_a_conflict() {
        guard.execute("key-1", request(100_000), PaymentDtos.PaymentResponse.class, () -> {
            executions.incrementAndGet();
            return response("P1");
        });

        assertThatThrownBy(() -> guard.execute("key-1", request(999_999), PaymentDtos.PaymentResponse.class, () -> {
            executions.incrementAndGet();
            return response("P2");
        }))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.IDEMPOTENCY_CONFLICT);

        assertThat(executions.get()).isEqualTo(1);
    }

    @Test
    @DisplayName("a failed attempt releases the key, so a retry is not blocked forever")
    void a_failed_action_releases_the_key() {
        assertThatThrownBy(() -> guard.execute("key-1", request(100_000), PaymentDtos.PaymentResponse.class, () -> {
            executions.incrementAndGet();
            throw DomainException.of(kz.taxi.payment.domain.PaymentErrorCode.INSUFFICIENT_FUNDS, "no money");
        })).isInstanceOf(DomainException.class);

        IdempotencyOutcome<PaymentDtos.PaymentResponse> retry = guard.execute("key-1", request(100_000),
                PaymentDtos.PaymentResponse.class, () -> {
                    executions.incrementAndGet();
                    return response("P1");
                });

        assertThat(retry.replayed()).isFalse();
        assertThat(executions.get()).isEqualTo(2);
    }

    @Test
    @DisplayName("a missing key is refused before anything is executed")
    void a_missing_key_is_refused() {
        assertThatThrownBy(() -> guard.execute("  ", request(100_000), PaymentDtos.PaymentResponse.class, () -> {
            executions.incrementAndGet();
            return response("P1");
        }))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(CommonErrorCode.VALIDATION_FAILED);

        assertThat(executions.get()).isZero();
    }

    @Test
    @DisplayName("different keys are different payments, even with an identical body")
    void different_keys_are_not_deduplicated() {
        guard.execute("key-1", request(100_000), PaymentDtos.PaymentResponse.class, () -> {
            executions.incrementAndGet();
            return response("P1");
        });
        guard.execute("key-2", request(100_000), PaymentDtos.PaymentResponse.class, () -> {
            executions.incrementAndGet();
            return response("P2");
        });

        assertThat(executions.get()).isEqualTo(2);
    }
}
