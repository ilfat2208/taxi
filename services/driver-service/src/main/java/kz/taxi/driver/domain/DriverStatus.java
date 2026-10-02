package kz.taxi.driver.domain;

/**
 * What a driver is doing right now.
 *
 * <p>Only three states, because dispatch must answer one question fast: may this
 * driver be offered a trip? {@link #ONLINE} means yes, {@link #BUSY} means he is
 * already driving, {@link #OFFLINE} means he is not working at all. A separate
 * "on a break" state would be a product decision, not a dispatch one.
 */
public enum DriverStatus {

    /** Not on duty: no offers, and no position is expected from the app. */
    OFFLINE,
    /** On duty and free: this is the only state dispatch may offer a trip to. */
    ONLINE,
    /** On duty and carrying a rider: positions are still tracked, offers are not. */
    BUSY
}
