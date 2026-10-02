package kz.taxi.payment.domain;

import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Durable marker of the saga step a payment is currently in, and of the hold it
 * is working with: {@code STEP} or {@code STEP#holdId} (e.g. {@code CAP#01J8ZCQ7Y4R3F0N5G8K2M9QW1T}).
 *
 * <p><strong>Why the hold id is packed into this value.</strong> The schema is
 * frozen: {@code payment} has no {@code hold_id} column, yet the recovery job
 * cannot decide anything without it. "No active hold for this payment" is
 * ambiguous — it means either "the hold expired, the money never moved, fail the
 * payment" or "the hold was captured and only the local commit was lost, complete
 * the payment". Guessing between those two writes a wrong ledger history, and
 * guessing wrong in the second case loses a customer's money. With the hold id
 * the recovery job asks the account service for the exact hold status and stops
 * guessing; the column is {@code VARCHAR(32)} and {@code "REL#" + 26} = 30
 * characters, so the whole marker fits by construction (enforced below).
 *
 * <p>The step token is what makes the intent survive: {@code REL#…} says the saga
 * had already decided to compensate, so the recovery job finishes the
 * compensation instead of completing a payment the caller was told to retry.
 */
public record PaymentSagaMarker(Step step, String holdId) {

    /** Token written into {@code payment.saga_state} plus the 26-character ULID of the hold. */
    public static final int COLUMN_LENGTH = 32;

    private static final String SEPARATOR = "#";
    private static final Pattern COLUMN_VALUE = Pattern.compile("^([A-Z]+)(?:#([0-9A-Z]{26}))?$");

    /** The saga steps that own a remote call, in the order they happen. */
    public enum Step {

        /** A hold was requested on the source account; the response may or may not have been recorded. */
        HOLDING("HOLD"),

        /** A capture for that hold was requested: money may already have moved. */
        CAPTURING("CAP"),

        /** The saga is compensating: the hold must be released and the payment failed. */
        RELEASING("REL");

        private final String token;

        Step(String token) {
            this.token = token;
        }

        public String token() {
            return token;
        }

        static Step ofToken(String token) {
            for (Step step : values()) {
                if (step.token.equals(token)) {
                    return step;
                }
            }
            return null;
        }
    }

    public PaymentSagaMarker {
        Objects.requireNonNull(step, "step must not be null");
        if (holdId != null && holdId.isBlank()) {
            holdId = null;
        }
        if (step == Step.CAPTURING || step == Step.RELEASING) {
            if (holdId == null) {
                throw new IllegalStateException("saga step " + step + " must carry the hold it acts on");
            }
        }
        if (holdId != null && step.token().length() + 1 + holdId.length() > COLUMN_LENGTH) {
            throw new IllegalStateException("saga marker does not fit into saga_state(" + COLUMN_LENGTH + "): "
                    + step.token() + SEPARATOR + holdId);
        }
    }

    /** The hold has been requested but its id is not known yet. */
    public static PaymentSagaMarker holding() {
        return new PaymentSagaMarker(Step.HOLDING, null);
    }

    /** The hold is known; the capture has not been requested yet. */
    public static PaymentSagaMarker held(String holdId) {
        return new PaymentSagaMarker(Step.HOLDING, holdId);
    }

    public static PaymentSagaMarker capturing(String holdId) {
        return new PaymentSagaMarker(Step.CAPTURING, holdId);
    }

    public static PaymentSagaMarker releasing(String holdId) {
        return new PaymentSagaMarker(Step.RELEASING, holdId);
    }

    /**
     * Reads a marker back. Returns {@code null} when the column is empty or holds
     * something this version does not understand: a payment whose marker cannot be
     * read is treated by the recovery job as "no remote call was confirmed", which
     * is the fail-safe direction (it never claims money moved when it cannot prove it).
     */
    public static PaymentSagaMarker parse(String columnValue) {
        if (columnValue == null || columnValue.isBlank()) {
            return null;
        }
        var matcher = COLUMN_VALUE.matcher(columnValue.trim());
        if (!matcher.matches()) {
            return null;
        }
        Step step = Step.ofToken(matcher.group(1));
        if (step == null) {
            return null;
        }
        String holdId = matcher.group(2);
        if (holdId == null && (step == Step.CAPTURING || step == Step.RELEASING)) {
            // A capture/release marker without a hold id is unusable: never guess.
            return null;
        }
        return new PaymentSagaMarker(step, holdId);
    }

    /** Value to store in {@code payment.saga_state}. */
    public String toColumnValue() {
        return holdId == null ? step.token() : step.token() + SEPARATOR + holdId;
    }

    public boolean hasHoldId() {
        return holdId != null;
    }

    /** The saga had already decided to give the reserved money back. */
    public boolean isCompensating() {
        return step == Step.RELEASING;
    }
}
