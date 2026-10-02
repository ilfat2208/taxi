package kz.taxi.payment.application;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import kz.taxi.common.core.money.Currency;
import kz.taxi.payment.domain.PaymentType;
import kz.taxi.payment.domain.SettlementStatus;
import kz.taxi.payment.infrastructure.PaymentRepository;
import kz.taxi.payment.infrastructure.SettlementRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Business metrics — the numbers an on-call engineer actually alarms on.
 *
 * <p>Technical metrics (JVM, HTTP latency) say the service is alive; these say the
 * <em>product</em> is healthy. Two of them matter more than the rest:
 *
 * <ul>
 *   <li>{@code taxi.settlement.debt.minor} — how much money the platform owes
 *       merchants right now. A number that only grows means payouts are broken, and
 *       nobody notices until a merchant calls.</li>
 *   <li>{@code taxi.outbox.pending} — events written but not yet on Kafka. Growth
 *       means the relay is stuck, and every downstream service is silently working
 *       with stale data.</li>
 * </ul>
 *
 * <p>Naming follows the platform convention {@code taxi.<domain>.<fact>} so a single
 * dashboard can aggregate across services.
 */
@Component
@Slf4j
public class PaymentMetrics {

    private final MeterRegistry registry;
    private final SettlementRepository settlements;

    public PaymentMetrics(MeterRegistry registry,
                          SettlementRepository settlements,
                          PaymentRepository payments) {
        this.registry = registry;
        this.settlements = settlements;

        gauge("taxi.settlement.debt.minor", settlements::sumUnpaidNetMinor);
        gauge("taxi.settlement.overdue.count",
                () -> settlements.countByStatusNotAndCreatedAtBefore(kz.taxi.payment.domain.SettlementStatus.PAID, Instant.now().minus(1, ChronoUnit.DAYS)));
        gauge("taxi.payment.open.count",
                () -> payments.countByStatus(kz.taxi.payment.domain.PaymentStatus.PENDING));
    }

    /** Terminal outcome of a payment, by type: the conversion funnel of the product. */
    public void paymentOutcome(PaymentType type, String status, Currency currency) {
        Counter.builder("taxi.payment.outcome")
                .description("Payments that reached a terminal state")
                .tag("type", type == null ? "UNKNOWN" : type.name())
                .tag("status", status)
                .tag("currency", currency == null ? "UNKNOWN" : currency.name())
                .register(registry)
                .increment();
    }

    public void paymentFailed(String failureCode) {
        Counter.builder("taxi.payment.failed")
                .description("Payments that failed, by reason — the first thing to look at when the success rate drops")
                .tag("reason", failureCode == null ? "UNKNOWN" : failureCode)
                .register(registry)
                .increment();
    }

    public void settlementOutcome(SettlementStatus status) {
        Counter.builder("taxi.settlement.outcome")
                .description("Settlements that reached a state, by status")
                .tag("status", status.name())
                .register(registry)
                .increment();
    }

    /** Findings of the reconciliation pass, by kind: zero is the only healthy value. */
    public void reconciliationFinding(String kind) {
        Counter.builder("taxi.reconciliation.findings")
                .description("Data inconsistencies found by the reconciliation job")
                .tag("kind", kind)
                .register(registry)
                .increment();
    }

    /**
     * Registers a gauge that reads straight from the database.
     *
     * <p>Gauges are polled by the metrics endpoint, so the supplier must never throw:
     * a failing database would otherwise turn a metrics scrape into an error page.
     */
    private void gauge(String name, java.util.function.Supplier<Number> supplier) {
        Gauge.builder(name, supplier, source -> {
            try {
                Number value = source.get();
                return value == null ? 0d : value.doubleValue();
            } catch (RuntimeException failure) {
                log.debug("gauge {} could not read its value", name, failure);
                return 0d;
            }
        }).register(registry);
    }
}
