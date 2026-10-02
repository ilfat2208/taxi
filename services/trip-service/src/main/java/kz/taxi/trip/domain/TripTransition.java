package kz.taxi.trip.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * Append-only history of one trip's status moves.
 *
 * <p>Why a table and not a status column plus logs: the timeline is a <em>product</em>
 * feature (the rider's screen shows "машина назначена 14:03, водитель приехал 14:07"),
 * a support tool (the answer to "why was I charged" starts with when the ride started)
 * and the only honest way to count how long riders wait. A log line would give none of
 * those to a client.
 *
 * <p>Rows are never updated or deleted. {@code actor} records who caused the move —
 * the rider, the dispatcher, the driver side or the platform itself — because
 * "CANCELLED_BY_RIDER" alone is not enough when a dispatcher cancelled on the rider's
 * behalf.
 */
@Entity
@Table(name = "trip_transition")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class TripTransition {

    /** The rider (or the app acting for him). */
    public static final String ACTOR_RIDER = "rider";
    /** The dispatcher's console inside the API, or the internal dispatch API. */
    public static final String ACTOR_DISPATCHER = "dispatcher";
    /** The support desk: allowed to close somebody else's ride, with a reason. */
    public static final String ACTOR_SUPPORT = "support";
    /** The driver side: the app, or the dispatcher acting for a driver. */
    public static final String ACTOR_DRIVER = "driver";
    /** The platform itself: the automatic driver search, a compensation. */
    public static final String ACTOR_SYSTEM = "system";

    private static final int REASON_LENGTH = 512;

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "trip_id", length = 26, nullable = false, updatable = false)
    private String tripId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", length = 24)
    private TripStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", length = 24, nullable = false)
    private TripStatus toStatus;

    @Column(name = "actor", length = 32)
    private String actor;

    @Column(name = "reason", length = REASON_LENGTH)
    private String reason;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    public static TripTransition of(String tripId,
                                    TripStatus fromStatus,
                                    TripStatus toStatus,
                                    String actor,
                                    String reason,
                                    Instant occurredAt) {
        TripTransition transition = new TripTransition();
        transition.id = Ulid.nextId();
        transition.tripId = tripId;
        transition.fromStatus = fromStatus;
        transition.toStatus = toStatus;
        transition.actor = actor;
        transition.reason = truncate(reason);
        transition.occurredAt = occurredAt;
        return transition;
    }

    private static String truncate(String reason) {
        if (reason == null) {
            return null;
        }
        return reason.length() <= REASON_LENGTH ? reason : reason.substring(0, REASON_LENGTH);
    }

    /** A rating is recorded as a transition too, so "когда поставили оценку" is answerable. */
    public static TripTransition rating(String tripId, String actor, Instant occurredAt) {
        TripTransition transition = new TripTransition();
        transition.id = Ulid.nextId();
        transition.tripId = tripId;
        transition.fromStatus = TripStatus.COMPLETED;
        transition.toStatus = TripStatus.COMPLETED;
        transition.actor = actor;
        transition.reason = "rated";
        transition.occurredAt = occurredAt;
        return transition;
    }
}
