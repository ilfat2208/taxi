package kz.taxi.account.domain;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/**
 * Window arithmetic.
 *
 * <p>This is the code that decides when a customer's day starts over, so an
 * off-by-one here is measurable in money: a window that ends a day late means the
 * limit is effectively doubled.
 */
class LimitWindowTest {

    @Test
    @DisplayName("the daily window runs from midnight UTC, not from the moment of the request")
    void daily_window_is_a_calendar_day_in_utc() {
        Instant instant = Instant.parse("2025-03-14T18:45:12.345Z");

        assertThat(LimitWindow.DAILY.startOf(instant)).isEqualTo(Instant.parse("2025-03-14T00:00:00Z"));
        assertThat(LimitWindow.DAILY.endOf(instant)).isEqualTo(Instant.parse("2025-03-15T00:00:00Z"));
    }

    @Test
    @DisplayName("the monthly window runs from the first day of the month to the first of the next")
    void monthly_window_is_a_calendar_month() {
        assertThat(LimitWindow.MONTHLY.startOf(Instant.parse("2025-03-14T18:45:12Z")))
                .isEqualTo(Instant.parse("2025-03-01T00:00:00Z"));
        assertThat(LimitWindow.MONTHLY.endOf(Instant.parse("2025-03-14T18:45:12Z")))
                .isEqualTo(Instant.parse("2025-04-01T00:00:00Z"));
        // December must roll the year, not the month number.
        assertThat(LimitWindow.MONTHLY.endOf(Instant.parse("2025-12-31T23:59:59Z")))
                .isEqualTo(Instant.parse("2026-01-01T00:00:00Z"));
    }

    @Test
    @DisplayName("an unknown window name is a client error, never a silently unlimited window")
    void unknown_window_is_rejected() {
        assertThat(LimitWindow.of("daily")).isEqualTo(LimitWindow.DAILY);
        assertThat(LimitWindow.of(" Monthly ")).isEqualTo(LimitWindow.MONTHLY);

        DomainException unknown = catchThrowableOfType(() -> LimitWindow.of("WEEKLY"), DomainException.class);
        assertThat(unknown.errorCode()).isEqualTo(CommonErrorCode.VALIDATION_FAILED);
        assertThat(unknown.details()).containsEntry("supported", "DAILY, MONTHLY");

        assertThat(catchThrowableOfType(() -> LimitWindow.of(" "), DomainException.class).errorCode())
                .isEqualTo(CommonErrorCode.VALIDATION_FAILED);
    }
}
