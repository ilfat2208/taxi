package kz.taxi.payment.domain;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The packed saga marker.
 *
 * <p>Its whole reason to exist is the recovery job: the difference between
 * "capture the hold" and "release the hold, the money never moved" is a customer's
 * money, and the marker is the only durable thing that carries that difference
 * (the schema is frozen and has no hold_id column). So it is tested like a parser
 * of a protocol, including the inputs it must refuse rather than guess about.
 */
class PaymentSagaMarkerTest {

    private static final String HOLD_ID = "01J8ZCQ7Y4R3F0N5G8K2M9QW1T";

    @Test
    @DisplayName("the marker always fits into saga_state(32), hold id included")
    void marker_fits_into_the_column() {
        assertThat(PaymentSagaMarker.holding().toColumnValue()).isEqualTo("HOLD");
        assertThat(PaymentSagaMarker.held(HOLD_ID).toColumnValue()).isEqualTo("HOLD#" + HOLD_ID);
        assertThat(PaymentSagaMarker.capturing(HOLD_ID).toColumnValue()).isEqualTo("CAP#" + HOLD_ID);
        assertThat(PaymentSagaMarker.releasing(HOLD_ID).toColumnValue()).isEqualTo("REL#" + HOLD_ID);

        assertThat(PaymentSagaMarker.releasing(HOLD_ID).toColumnValue().length())
                .isLessThanOrEqualTo(PaymentSagaMarker.COLUMN_LENGTH);
    }

    @Test
    @DisplayName("every marker survives the round trip through the column")
    void round_trip() {
        PaymentSagaMarker holding = PaymentSagaMarker.parse("HOLD");
        assertThat(holding.step()).isEqualTo(PaymentSagaMarker.Step.HOLDING);
        assertThat(holding.hasHoldId()).isFalse();

        PaymentSagaMarker capturing = PaymentSagaMarker.parse("CAP#" + HOLD_ID);
        assertThat(capturing.step()).isEqualTo(PaymentSagaMarker.Step.CAPTURING);
        assertThat(capturing.holdId()).isEqualTo(HOLD_ID);
        assertThat(capturing.isCompensating()).isFalse();

        PaymentSagaMarker releasing = PaymentSagaMarker.parse("REL#" + HOLD_ID);
        assertThat(releasing.step()).isEqualTo(PaymentSagaMarker.Step.RELEASING);
        assertThat(releasing.holdId()).isEqualTo(HOLD_ID);
        assertThat(releasing.isCompensating()).isTrue();
    }

    @Test
    @DisplayName("an unreadable marker is null, never a guess")
    void unreadable_markers_are_null() {
        assertThat(PaymentSagaMarker.parse(null)).isNull();
        assertThat(PaymentSagaMarker.parse("")).isNull();
        assertThat(PaymentSagaMarker.parse("   ")).isNull();
        assertThat(PaymentSagaMarker.parse("WHATEVER")).isNull();
        assertThat(PaymentSagaMarker.parse("hold")).isNull();
        // A capture or a release without the hold it acts on cannot be acted upon.
        assertThat(PaymentSagaMarker.parse("CAP")).isNull();
        assertThat(PaymentSagaMarker.parse("REL")).isNull();
        assertThat(PaymentSagaMarker.parse("CAP#not-a-ulid")).isNull();
    }

    @Test
    @DisplayName("a marker that cannot carry its hold id is refused at construction")
    void oversized_marker_is_refused() {
        assertThatThrownBy(() -> PaymentSagaMarker.releasing("X".repeat(30)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("saga_state");

        assertThatThrownBy(() -> PaymentSagaMarker.capturing(null))
                .isInstanceOf(IllegalStateException.class);
    }
}
