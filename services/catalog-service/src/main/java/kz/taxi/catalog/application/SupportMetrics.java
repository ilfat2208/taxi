package kz.taxi.catalog.application;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import kz.taxi.catalog.domain.SupportResourceType;
import org.springframework.stereotype.Component;

/**
 * Business metrics of support access.
 *
 * <p>Metric names follow the platform convention {@code taxi.<domain>.<fact>}, so
 * one dashboard can aggregate across services:
 *
 * <ul>
 *   <li>{@code taxi.catalog.support.read} — counter of <strong>successful</strong>
 *       support reads of merchant data. Tag {@code resource} is the
 *       {@link SupportResourceType} that was read (MERCHANT, PRODUCT, STOCK,
 *       RESERVATION).</li>
 * </ul>
 *
 * <p>Only successful reads are counted, which is the same rule the audit trail
 * follows: the metric and the audit row then answer the same question ("did anyone
 * actually see this data?"), and a steady trickle of
 * {@code resource=MERCHANT} reads with no complaints behind them is the signal that
 * somebody is browsing the platform. Failed lookups are not counted — they handed
 * nobody any data, and they are visible as 404s in the access logs.
 */
@Component
public class SupportMetrics {

    /** Counter name; the resource type is the tag. */
    public static final String SUPPORT_READ = "taxi.catalog.support.read";

    private final MeterRegistry registry;

    public SupportMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public void supportRead(SupportResourceType resource) {
        Counter.builder(SUPPORT_READ)
                .description("Successful support reads of merchant data, by the kind of resource read")
                .tag("resource", resource.name())
                .register(registry)
                .increment();
    }
}
