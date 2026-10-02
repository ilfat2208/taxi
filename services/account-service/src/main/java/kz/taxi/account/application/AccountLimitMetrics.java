package kz.taxi.account.application;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Component;

/**
 * Fraud-control counters.
 *
 * <p>Metric names follow the platform style {@code taxi.<domain>.<fact>} — a
 * dot-separated sentence, lowercase, no abbreviations — so a dashboard panel is
 * readable without a lookup table:
 * <ul>
 *   <li>{@code taxi.account.limit.refusals} — counter, tags
 *       {@code reason=LIMIT_EXCEEDED|VELOCITY_EXCEEDED} and
 *       {@code window=DAILY|MONTHLY|VELOCITY}. This is the number a fraud analyst
 *       actually watches: a step change means either a limit is too tight or
 *       someone is probing accounts.</li>
 * </ul>
 *
 * <p>Tag values are bounded sets (never an account id) on purpose: a per-account
 * tag would create one time series per wallet and take the metrics backend down
 * long before it takes the payment path down.
 */
@Component
public class AccountLimitMetrics {

    /** Refusals of an outgoing operation by the limit/velocity control. */
    public static final String REFUSALS = "taxi.account.limit.refusals";

    public static final String REASON_TAG = "reason";
    public static final String WINDOW_TAG = "window";

    /** Window tag used when the refusal came from the velocity check, not an amount limit. */
    public static final String VELOCITY = "VELOCITY";

    private final MeterRegistry registry;

    public AccountLimitMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    /** Counts one refused outgoing operation, tagged with why and over which window. */
    public void recordRefusal(String reason, String window) {
        Counter.builder(REFUSALS)
                .description("Outgoing account operations refused by a limit or velocity control")
                .tag(REASON_TAG, reason)
                .tag(WINDOW_TAG, window)
                .register(registry)
                .increment();
    }
}
