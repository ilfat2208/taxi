package kz.taxi.qtime.domain;

/**
 * Why a cell of the grid is not bookable.
 *
 * <p>The grid shows unavailable cells too (greyed out, like the mockup): a client
 * who sees 12:30 crossed out learns "мастер занят, вот 15:30", while a grid that
 * silently skips the time leaves them wondering whether the app is broken. The
 * reason is therefore part of the answer, not an internal detail.
 */
public enum SlotUnavailability {

    /** An active booking already intersects this window. */
    BUSY,
    /** The service would run into the specialist's break (90 minutes do not fit before lunch). */
    BREAK,
    /** The service would run past the end of the shift. */
    NOT_ENOUGH_TIME
}
