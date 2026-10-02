package kz.taxi.account.domain;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Locale;

/**
 * The windows an outgoing limit is measured over.
 *
 * <p>Boundaries are calendar boundaries in UTC, not rolling windows. That is a
 * deliberate fraud-control choice: a rolling window lets a spender commit the
 * limit, wait for the oldest operation to age out and commit it again, so the
 * effective ceiling drifts upwards all day. A calendar window resets at a moment
 * the customer, support and the fraud team can all name.
 *
 * <p>UTC and not the customer's local time: the service must not have a per-user
 * timezone dependency on the money path, and "the day changed" must be the same
 * fact for every replica.
 */
public enum LimitWindow {

    DAILY,
    MONTHLY;

    private static final ZoneOffset ACCOUNT_ZONE = ZoneOffset.UTC;

    /** First instant of the window containing {@code instant}. */
    public Instant startOf(Instant instant) {
        return switch (this) {
            case DAILY -> instant.atZone(ACCOUNT_ZONE).truncatedTo(ChronoUnit.DAYS).toInstant();
            case MONTHLY -> instant.atZone(ACCOUNT_ZONE)
                    .withDayOfMonth(1)
                    .truncatedTo(ChronoUnit.DAYS)
                    .toInstant();
        };
    }

    /** First instant of the next window: what a client shows as "resets at". */
    public Instant endOf(Instant instant) {
        Instant start = startOf(instant);
        return switch (this) {
            case DAILY -> start.plus(1, ChronoUnit.DAYS);
            case MONTHLY -> start.atZone(ACCOUNT_ZONE).plus(1, ChronoUnit.MONTHS).toInstant();
        };
    }

    /**
     * Parses a window name from an API or configuration value.
     *
     * <p>Unknown or blank names are a client error (400), never a silently
     * unlimited window: the failure mode of "we did not understand the window, so
     * we enforced nothing" is exactly the failure this service exists to prevent.
     */
    public static LimitWindow of(String raw) {
        if (raw == null || raw.isBlank()) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED, "window is required");
        }
        try {
            return valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                            "unknown window '{}', expected one of DAILY, MONTHLY", raw)
                    .withDetail("window", raw)
                    .withDetail("supported", "DAILY, MONTHLY");
        }
    }
}
