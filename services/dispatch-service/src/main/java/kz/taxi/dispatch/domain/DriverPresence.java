package kz.taxi.dispatch.domain;

/**
 * What dispatch knows about a driver without asking anybody.
 *
 * <p>This is a projection of {@code driver.events}: the driver service owns the
 * profile, and dispatch keeps only what it needs to answer "who can take a trip".
 * Duplicating data is normally a smell; here it is the point — the candidate
 * search runs on the hot path and must not perform a synchronous call per driver.
 *
 * @param status same vocabulary as the driver service: OFFLINE, ONLINE, BUSY
 */
public record DriverPresence(String driverId,
                             String userId,
                             String displayName,
                             String phone,
                             String status) {

    public static final String ONLINE = "ONLINE";
    public static final String BUSY = "BUSY";
    public static final String OFFLINE = "OFFLINE";

    /** On duty in any sense: available or busy. */
    public boolean onDuty() {
        return ONLINE.equals(status) || BUSY.equals(status);
    }

    /** The only state a trip may be offered to. The fleet map shows both. */
    public boolean available() {
        return ONLINE.equals(status);
    }
}
