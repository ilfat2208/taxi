package kz.taxi.payment;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.core.outbox.OutboxStatus;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxMessage;
import kz.taxi.common.kafka.outbox.OutboxRepository;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.application.PaymentSagaService;
import kz.taxi.payment.domain.Payment;
import kz.taxi.payment.domain.PaymentErrorCode;
import kz.taxi.payment.domain.PaymentStatus;
import kz.taxi.payment.domain.PaymentTransition;
import kz.taxi.payment.domain.Refund;
import kz.taxi.payment.domain.RefundStatus;
import kz.taxi.payment.infrastructure.AccountServiceClient;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.PaymentTransitionRepository;
import kz.taxi.payment.infrastructure.RefundRepository;
import kz.taxi.payment.support.ItInfrastructure;
import kz.taxi.payment.support.TestPayments;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * End-to-end saga against a real PostgreSQL 16 and the real Flyway migrations.
 *
 * <p><strong>What is stubbed:</strong> only the counterpart — {@link AccountServiceClient}
 * is replaced by {@link StubAccountServiceClient}, an in-memory double that records
 * the calls it receives. Everything else is real: the frozen schema, the migrations,
 * Hibernate validation of the mappings, the transactional steps, the state machine
 * and the outbox. The Kafka relay is switched off
 * ({@code taxi.outbox.enabled=false}) so the test can assert on the outbox rows
 * themselves instead of racing a publisher — deliberately: the row is the
 * guarantee, Kafka is only the delivery.
 *
 * <p><strong>Where the database comes from:</strong> Testcontainers starts a
 * {@code postgres:16} container — unless {@code IT_DATABASE_URL} is set, in which case
 * the test runs against that already-migrated-to-be database and starts nothing. See
 * {@link ItInfrastructure} for why the choice exists and how to make it, and
 * {@code scripts/it-local.ps1} for the local invocation. Flyway migrates whichever
 * database it is, so the external one must be dedicated to tests (a database that holds
 * demo data would be rewritten by the migrations), and {@link #cleanDatabase()} empties
 * it before every scenario, which is what makes a second run of the class on a
 * container-less, long-lived database produce the same result as the first.
 *
 * <p>Runs only with {@code -Pintegration} (failsafe, {@code *IT}); without a usable
 * Docker and without {@code IT_DATABASE_URL} the class is reported as skipped.
 */
@EnabledIf(ItInfrastructure.AVAILABLE_METHOD)
@SpringBootTest(properties = {
        "taxi.outbox.enabled=false",
        "taxi.idempotency.store=memory",
        "taxi.kafka.dedup.store=memory",
        "spring.kafka.admin.fail-fast=false",
        "taxi.payments.saga.fixed-delay-ms=3600000",
        "taxi.payments.saga.initial-delay-ms=3600000",
        // The settlement job writes rows and calls the catalog service, and the suite
        // asserts on an empty-ish database: a background writer would be the only source
        // of flakiness this class has.
        "taxi.settlement.enabled=false"
})
class PaymentSagaIT {

    /**
     * Started by {@link ItInfrastructure#start} <em>unless</em> {@code IT_DATABASE_URL}
     * points the test at an already-running database; never referenced before the
     * {@code @EnabledIf} condition above has passed.
     */
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"));

    private static final ItInfrastructure INFRASTRUCTURE = ItInfrastructure.start(POSTGRES);

    @DynamicPropertySource
    static void infrastructure(DynamicPropertyRegistry registry) {
        INFRASTRUCTURE.register(registry);
    }

    private static final String SOURCE_ACCOUNT = "A-1";
    private static final String TARGET_ACCOUNT = "A-2";
    private static final String OWNER = "U-1";

    @TestConfiguration
    static class StubbedAccountService {

        @Bean
        @Primary
        StubAccountServiceClient stubAccountServiceClient() {
            return new StubAccountServiceClient();
        }
    }

    @Autowired
    private PaymentSagaService saga;

    @Autowired
    private PaymentRepository payments;

    @Autowired
    private PaymentTransitionRepository transitions;

    @Autowired
    private RefundRepository refunds;

    @Autowired
    private OutboxRepository outbox;

    @Autowired
    private StubAccountServiceClient accountService;

    @Autowired
    private Flyway flyway;

    @Autowired
    private JdbcTemplate jdbc;

    private final AuthenticatedUser caller = TestPayments.customer(OWNER);

    @BeforeEach
    void resetStub() {
        cleanDatabase();
        accountService.reset();
    }

    /**
     * Empties the service's tables before every scenario.
     *
     * <p>A Testcontainers database is new for every run; the external one is not, and a
     * suite that only works on a virgin database is a suite that fails on the second run
     * for reasons that have nothing to do with the code. Deletion follows the foreign
     * keys (a payment is referenced by its transitions, its refunds and by
     * {@code settlement_payment}), so the order below is the constraint graph, not a
     * preference.
     */
    private void cleanDatabase() {
        jdbc.execute("delete from payment.settlement_payment");
        jdbc.execute("delete from payment.merchant_settlement");
        jdbc.execute("delete from payment.payment_transition");
        jdbc.execute("delete from payment.refund");
        jdbc.execute("delete from payment.outbox_message");
        jdbc.execute("delete from payment.payment");
    }

    /**
     * An order id of the shape order-service really sends: the primary key of
     * {@code customer_order}, a 26-character ULID — order-service passes
     * {@code order.getId()} to this service. {@code payment.order_id} is {@code VARCHAR(26)}
     * like every other id on the platform, so an id that carries a prefix (an order
     * <em>number</em> looks like {@code ORD-250101-00042}, and a number is not an id)
     * would be refused by the database with SQLState 22001. That refusal is exactly what
     * this class used to hide behind "idempotency key already exists": see
     * {@code PaymentStateService#initiate}.
     */
    private static String newOrderId() {
        return Ulid.nextId();
    }

    @Test
    @DisplayName("Flyway migrated the frozen schema and the outbox table is mapped")
    void schema_is_migrated() {
        assertThat(flyway.info().applied()).isNotEmpty();
        assertThat(flyway.info().current().getVersion()).isNotNull();
        assertThat(outbox.count()).isGreaterThanOrEqualTo(0L);
    }

    @Test
    @DisplayName("a merchant payment is persisted as COMPLETED, keeps its history and writes both events")
    void merchant_payment_persists_the_state_machine_and_writes_the_outbox() {
        String orderId = newOrderId();
        PaymentDtos.PaymentResponse response = saga.merchantPayment(caller,
                new PaymentDtos.MerchantPaymentRequest(SOURCE_ACCOUNT, "M-1", 100_000, Currency.KZT,
                        "order 42", orderId),
                "it-merchant-" + Ulid.nextId());

        assertThat(response.status()).isEqualTo(PaymentStatus.COMPLETED.name());
        assertThat(response.amountMinor()).isEqualTo(100_000);
        assertThat(response.feeMinor()).isEqualTo(1_500);
        assertThat(response.totalMinor()).isEqualTo(101_500);
        assertThat(response.orderId()).isEqualTo(orderId);

        Payment stored = payments.findById(response.paymentId()).orElseThrow();
        assertThat(stored.getStatus()).isEqualTo(PaymentStatus.COMPLETED);
        assertThat(stored.getOwnerUserId()).isEqualTo(OWNER);
        assertThat(stored.getSagaState())
                .as("a terminal payment has no saga step left to resume")
                .isNull();
        assertThat(stored.getCompletedAt()).isNotNull();
        assertThat(stored.getTotalMinor()).isEqualTo(stored.getAmountMinor() + stored.getFeeMinor());

        assertThat(transitions.findByPaymentIdOrderByCreatedAtAsc(response.paymentId()))
                .extracting(PaymentSagaIT::describe)
                .containsExactly("null->INITIATED:api", "INITIATED->PENDING:saga", "PENDING->COMPLETED:saga");

        List<OutboxMessage> events = outbox.findByAggregateIdOrderByCreatedAtAsc(response.paymentId());
        assertThat(events)
                .extracting(OutboxMessage::getEventType)
                .containsExactly(KafkaTopics.Events.PAYMENT_INITIATED, KafkaTopics.Events.PAYMENT_COMPLETED);
        assertThat(events).allSatisfy(event -> {
            assertThat(event.getTopic()).isEqualTo(KafkaTopics.PAYMENT_EVENTS);
            assertThat(event.getAggregateType()).isEqualTo("Payment");
            assertThat(event.getPartitionKey()).isEqualTo(response.paymentId());
            assertThat(event.getStatus())
                    .as("the row is the guarantee; it stays PENDING until the relay publishes it")
                    .isEqualTo(OutboxStatus.PENDING);
        });
        assertThat(events.get(1).getPayload())
                .contains("\"orderId\":\"" + orderId)
                .contains("\"feeMinor\":1500")
                .contains("\"totalMinor\":101500")
                .contains("\"status\":\"COMPLETED\"")
                .contains("\"completedAt\"")
                .contains("\"occurredAt\"");
    }

    @Test
    @DisplayName("a transfer reserves funds and then captures them, in that order, on one hold")
    void transfer_holds_then_captures_via_the_account_service() {
        PaymentDtos.PaymentResponse response = saga.transfer(caller,
                new PaymentDtos.TransferRequest(SOURCE_ACCOUNT, "+77001112233", null, 250_000, Currency.KZT,
                        "lunch"),
                "it-transfer-" + Ulid.nextId());

        assertThat(response.status()).isEqualTo(PaymentStatus.COMPLETED.name());
        assertThat(response.targetAccountId()).isEqualTo(TARGET_ACCOUNT);

        assertThat(accountService.calls())
                .as("the recipient is resolved before any row exists, and the hold always precedes the capture")
                .containsExactly("getAccount:" + SOURCE_ACCOUNT, "resolveByPhone:+77001112233",
                        "placeHold:" + response.paymentId(), "capture:" + response.paymentId());
        assertThat(accountService.lastHold().referenceType()).isEqualTo(AccountServiceClient.REFERENCE_TYPE_PAYMENT);
        assertThat(accountService.lastHold().referenceId()).isEqualTo(response.paymentId());
        assertThat(accountService.lastHold().idempotencyKey()).isEqualTo(response.paymentId());
        assertThat(accountService.lastHold().amountMinor()).isEqualTo(250_000);
        assertThat(accountService.lastCapture().targetAccountId()).isEqualTo(TARGET_ACCOUNT);
        assertThat(accountService.lastCapture().operation()).isEqualTo("P2P_TRANSFER");

        assertThat(payments.findById(response.paymentId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.COMPLETED);
        assertThat(outbox.findByAggregateIdOrderByCreatedAtAsc(response.paymentId()))
                .extracting(OutboxMessage::getEventType)
                .containsExactly(KafkaTopics.Events.PAYMENT_INITIATED, KafkaTopics.Events.PAYMENT_COMPLETED);
    }

    @Test
    @DisplayName("a refused capture releases the hold and leaves a FAILED payment with its reason")
    void a_refused_capture_compensates_and_fails_the_payment() {
        String orderId = newOrderId();
        accountService.failCaptureWith(DomainException.of(PaymentErrorCode.HOLD_FAILED,
                "account service refused the capture"));

        assertThatThrownBy(() -> saga.merchantPayment(caller,
                new PaymentDtos.MerchantPaymentRequest(SOURCE_ACCOUNT, "M-1", 250_000, Currency.KZT, "order", orderId),
                "it-failed-" + Ulid.nextId()))
                .isInstanceOf(DomainException.class)
                .extracting(thrown -> ((DomainException) thrown).errorCode())
                .isEqualTo(PaymentErrorCode.HOLD_FAILED);

        Payment failed = payments.findByOrderIdOrderByCreatedAtDesc(orderId).get(0);
        assertThat(failed.getStatus()).isEqualTo(PaymentStatus.FAILED);
        assertThat(failed.getFailureCode()).isEqualTo(PaymentErrorCode.HOLD_FAILED.code());
        assertThat(failed.getSagaState()).isNull();
        assertThat(accountService.calls()).containsSubsequence(
                "capture:" + failed.getId(), "release:" + failed.getId());
        assertThat(outbox.findByAggregateIdOrderByCreatedAtAsc(failed.getId()))
                .extracting(OutboxMessage::getEventType)
                .containsExactly(KafkaTopics.Events.PAYMENT_INITIATED, KafkaTopics.Events.PAYMENT_FAILED);
    }

    @Test
    @DisplayName("a refund credits the payer once per refund id and reverses the payment when it is complete")
    void refund_credits_the_payer_and_reverses_the_payment() {
        PaymentDtos.PaymentResponse payment = saga.merchantPayment(caller,
                new PaymentDtos.MerchantPaymentRequest(SOURCE_ACCOUNT, "M-1", 100_000, Currency.KZT, "order",
                        newOrderId()),
                "it-refund-base-" + Ulid.nextId());

        PaymentDtos.RefundResponse partial = saga.refund(caller, payment.paymentId(),
                new PaymentDtos.RefundRequest(40_000L, "partial refund"), "it-refund-1-" + Ulid.nextId());

        assertThat(partial.status()).isEqualTo(RefundStatus.COMPLETED.name());
        assertThat(accountService.calls()).contains("credit:REFUND/" + partial.refundId());
        assertThat(payments.findById(payment.paymentId()).orElseThrow().getStatus())
                .as("a partial refund leaves the payment completed")
                .isEqualTo(PaymentStatus.COMPLETED);

        PaymentDtos.RefundResponse rest = saga.refund(caller, payment.paymentId(),
                new PaymentDtos.RefundRequest(null, "the rest"), "it-refund-2-" + Ulid.nextId());

        assertThat(rest.amountMinor()).isEqualTo(60_000);
        assertThat(payments.findById(payment.paymentId()).orElseThrow().getStatus())
                .isEqualTo(PaymentStatus.REVERSED);
        assertThat(refunds.findByPaymentIdOrderByCreatedAtAsc(payment.paymentId()))
                .extracting(Refund::getAmountMinor)
                .containsExactlyInAnyOrder(40_000L, 60_000L);
        assertThat(outbox.findByAggregateIdOrderByCreatedAtAsc(payment.paymentId()))
                .extracting(OutboxMessage::getEventType)
                .containsExactly(KafkaTopics.Events.PAYMENT_INITIATED, KafkaTopics.Events.PAYMENT_COMPLETED,
                        KafkaTopics.Events.PAYMENT_REVERSED);
    }

    private static String describe(PaymentTransition transition) {
        return (transition.getFromStatus() == null ? "null" : transition.getFromStatus().name())
                + "->" + transition.getToStatus().name() + ":" + transition.getActor();
    }

    /**
     * In-memory stand-in for the account service.
     *
     * <p>It keeps the two behaviours the saga depends on and that a naive stub
     * usually gets wrong: a hold is idempotent by its key, and a capture moves a hold
     * from ACTIVE to CAPTURED exactly once.
     */
    static class StubAccountServiceClient implements AccountServiceClient {

        private final List<String> calls = Collections.synchronizedList(new ArrayList<>());
        private final Map<String, HoldSnapshot> holds = new ConcurrentHashMap<>();
        private final Map<String, String> holdIdByKey = new ConcurrentHashMap<>();
        private final Map<String, String> referenceByHold = new ConcurrentHashMap<>();
        private final Set<String> creditedReferences = ConcurrentHashMap.newKeySet();

        private volatile DomainException captureFailure;
        private volatile HoldRequest lastHold;
        private volatile CaptureRequest lastCapture;

        void reset() {
            calls.clear();
            holds.clear();
            holdIdByKey.clear();
            referenceByHold.clear();
            creditedReferences.clear();
            captureFailure = null;
            lastHold = null;
            lastCapture = null;
        }

        void failCaptureWith(DomainException failure) {
            this.captureFailure = failure;
        }

        List<String> calls() {
            return List.copyOf(calls);
        }

        HoldRequest lastHold() {
            return lastHold;
        }

        CaptureRequest lastCapture() {
            return lastCapture;
        }

        /** Calls are recorded by business reference, not by hold id: that is what the assertions talk about. */
        private String referenceOf(String holdId) {
            return referenceByHold.getOrDefault(holdId, holdId);
        }

        @Override
        public AccountSnapshot getAccount(String accountId) {
            calls.add("getAccount:" + accountId);
            return new AccountSnapshot(accountId, OWNER, "+77001234567", "KZT", "ACTIVE",
                    1_000_000, 0, 1_000_000);
        }

        @Override
        public ResolvedAccount resolveByPhone(String phone, Currency currency) {
            calls.add("resolveByPhone:" + phone);
            return new ResolvedAccount(TARGET_ACCOUNT, "U-2", currency.name(), "ACTIVE");
        }

        @Override
        public Optional<HoldSnapshot> findActiveHold(String referenceType, String referenceId, String accountId) {
            calls.add("findActiveHold:" + referenceId);
            return holds.values().stream()
                    .filter(hold -> hold.state() == HoldState.ACTIVE)
                    .filter(hold -> referenceId.equals(referenceOf(hold.holdId())))
                    .findFirst();
        }

        @Override
        public Optional<HoldSnapshot> findHold(String holdId) {
            calls.add("findHold:" + referenceOf(holdId));
            return Optional.ofNullable(holds.get(holdId));
        }

        @Override
        public HoldSnapshot placeHold(HoldRequest request) {
            calls.add("placeHold:" + request.referenceId());
            lastHold = request;
            String existingId = holdIdByKey.get(request.idempotencyKey());
            if (existingId != null) {
                HoldSnapshot existing = holds.get(existingId);
                return new HoldSnapshot(existing.holdId(), existing.accountId(), existing.amountMinor(),
                        existing.currency(), existing.status(), existing.availableMinor(), existing.expiresAt(),
                        true);
            }
            String holdId = Ulid.nextId();
            HoldSnapshot hold = new HoldSnapshot(holdId, request.accountId(), request.amountMinor(),
                    request.currency().name(), "ACTIVE", 900_000, null, false);
            holds.put(holdId, hold);
            holdIdByKey.put(request.idempotencyKey(), holdId);
            referenceByHold.put(holdId, request.referenceId());
            return hold;
        }

        @Override
        public CaptureResult capture(String holdId, CaptureRequest request) {
            calls.add("capture:" + referenceOf(holdId));
            lastCapture = request;
            if (captureFailure != null) {
                throw captureFailure;
            }
            HoldSnapshot hold = holds.get(holdId);
            holds.put(holdId, new HoldSnapshot(hold.holdId(), hold.accountId(), hold.amountMinor(),
                    hold.currency(), "CAPTURED", hold.availableMinor(), null, false));
            return new CaptureResult(holdId, "CAPTURED", "TX-" + holdId, hold.accountId(),
                    request.targetAccountId(), hold.amountMinor(), hold.currency(), false);
        }

        @Override
        public void release(String holdId, String reason) {
            calls.add("release:" + referenceOf(holdId));
            HoldSnapshot hold = holds.get(holdId);
            if (hold != null && hold.state() == HoldState.ACTIVE) {
                holds.put(holdId, new HoldSnapshot(holdId, hold.accountId(), hold.amountMinor(),
                        hold.currency(), "RELEASED", hold.availableMinor(), null, false));
            }
        }

        @Override
        public CreditResult credit(CreditRequest request) {
            calls.add("credit:" + request.referenceType() + "/" + request.referenceId());
            boolean first = creditedReferences.add(request.referenceType() + "/" + request.referenceId());
            return new CreditResult(request.accountId(), "TX-CREDIT", request.amountMinor(),
                    request.currency().name(), 1_000_000, !first);
        }
    }
}
