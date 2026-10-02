package kz.taxi.driver.domain;

/**
 * Papers a driver must hold.
 *
 * <p>Modelled as a set of kinds rather than booleans on the driver row: every one
 * of them has its own expiry date, and "whose medical check runs out this week"
 * has to be a query, not a spreadsheet. The list is short on purpose — it is the
 * minimum a ride-hailing platform must be able to prove in Kazakhstan
 * (licence, technical inspection, medical check).
 */
public enum DocumentKind {

    /** Driving licence. */
    DRIVING_LICENCE,
    /** Technical inspection of the vehicle. */
    VEHICLE_INSPECTION,
    /** Pre-shift medical check. */
    MEDICAL_CHECK
}
