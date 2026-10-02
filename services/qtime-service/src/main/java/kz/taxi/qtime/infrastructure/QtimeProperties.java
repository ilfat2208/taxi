package kz.taxi.qtime.infrastructure;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.ZoneId;

/**
 * The three numbers that define what "свободное окно" means.
 *
 * <p>{@code slotStepMinutes} is the granularity of the grid: 30 minutes is what
 * salons, СТО and clinics actually sell, and it keeps a 09:00-20:00 working day at
 * roughly twenty cells — a grid a person can read on a phone. It is a step, not a
 * duration: a 90-minute service still starts on the half hour, it simply occupies
 * three cells' worth of time.
 *
 * <p>{@code minLeadTimeMinutes} is the honest part of the promise: a master must see
 * an appointment before the client walks in, so "свободно сейчас" is offered no
 * earlier than half an hour from now. {@code bookingHorizonDays} bounds how far a
 * window may be claimed — a month is the horizon most salons publish, and it also
 * bounds the work of a single slot query.
 */
@ConfigurationProperties(prefix = "taxi.qtime")
@Getter
@Setter
public class QtimeProperties {

    /** Grid granularity in minutes. */
    private int slotStepMinutes = 30;

    /** How many days ahead a booking may be made. */
    private int bookingHorizonDays = 30;

    /** The shortest notice a client can give, in minutes. */
    private int minLeadTimeMinutes = 30;

    /** Zone used when a company has none of its own. */
    private String defaultTimezone = "Asia/Almaty";

    private Demo demo = new Demo();

    /** Demo data switch: companies, specialists, services and a few taken windows. */
    @Getter
    @Setter
    public static class Demo {

        /**
         * Seeding is idempotent (it checks the company table first), so leaving this on
         * in development is safe; a real deployment switches it off.
         */
        private boolean seed = true;
    }

    public ZoneId defaultZone() {
        return ZoneId.of(defaultTimezone);
    }

    /** The grid step as a duration, with the sanity floor a negative config would break. */
    public int effectiveSlotStepMinutes() {
        return slotStepMinutes < 5 ? 30 : slotStepMinutes;
    }

    /** A non-positive horizon would make every date unbookable; fall back to a month. */
    public int effectiveBookingHorizonDays() {
        return bookingHorizonDays < 1 ? 30 : bookingHorizonDays;
    }

    /** A negative lead time would let clients book the past; zero is allowed on purpose. */
    public int effectiveMinLeadTimeMinutes() {
        return Math.max(minLeadTimeMinutes, 0);
    }
}
