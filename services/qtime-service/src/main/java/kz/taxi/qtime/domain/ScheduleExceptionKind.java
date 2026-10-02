package kz.taxi.qtime.domain;

/**
 * What a one-off deviation from the weekly rule is.
 *
 * <p>{@link #VACATION} and {@link #DAY_OFF} both close the day and are kept apart
 * because a CRM shows them differently ("в отпуске до 12 июня" versus "выходной") —
 * the slot logic treats them identically, which is why the distinction is data, not
 * two code paths.
 */
public enum ScheduleExceptionKind {

    /** Multi-day absence; one row per day, so the slot query needs no range arithmetic. */
    VACATION,
    /** A single day the specialist does not work. */
    DAY_OFF,
    /**
     * The opposite case: work outside the weekly rule (a Saturday shift in a salon
     * that normally closes on Saturday). The row's times replace the rule for that
     * date, break included — the master works the hours somebody wrote down.
     */
    EXTRA_SHIFT;

    /** True when the whole day is closed, whatever the weekly rule says. */
    public boolean closesDay() {
        return this != EXTRA_SHIFT;
    }
}
