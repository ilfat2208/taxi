-- ---------------------------------------------------------------------------
-- trip-service schema: quotes, rides and their history.
--
-- Three tables, and the rules they encode are all about money:
--   1. amounts are BIGINT minor units with an explicit currency column, like every
--      other amount on the platform;
--   2. the arithmetic of a fare is checked by the database, not only by the code:
--      the parts of the price must add up, and the driver's share plus the
--      platform's commission must equal exactly what the rider pays;
--   3. an idempotency key identifies one ride forever — a client that retries an
--      order must not be able to produce a second one, even if the platform's
--      idempotency store is flushed.
-- ---------------------------------------------------------------------------

-- A price the platform promised, held for a few minutes. Stored rather than
-- recomputed: the rider orders the ride he was shown, not the tariff of the moment.
create table trip.quote (
    id                  varchar(26)  not null primary key,
    rider_user_id       varchar(64)  not null,
    -- The wallet the fare will be reserved on. Resolved while the quote is made,
    -- because that is the moment the rider's phone is known: a dispatcher assigning a
    -- car later has no way to find it.
    rider_account_id    varchar(26)  not null,
    tariff              varchar(16)  not null,
    pickup_lat          double precision not null,
    pickup_lon          double precision not null,
    pickup_address      varchar(256),
    dropoff_lat         double precision not null,
    dropoff_lon         double precision not null,
    dropoff_address     varchar(256),
    distance_m          integer      not null,
    duration_s          integer      not null,
    price_minor         bigint       not null,
    commission_bp       integer      not null,
    commission_minor    bigint       not null,
    driver_net_minor    bigint       not null,
    base_minor          bigint       not null,
    distance_minor      bigint       not null,
    time_minor          bigint       not null,
    currency            varchar(3)   not null,
    surge_bp            integer      not null,
    created_at          timestamptz  not null,
    expires_at          timestamptz  not null,
    consumed_at         timestamptz,
    consumed_trip_id    varchar(26),
    version             bigint       not null default 0,

    constraint ck_quote_tariff check (tariff in ('ECONOMY', 'COMFORT')),
    constraint ck_quote_amounts_non_negative
        check (price_minor >= 0 and commission_minor >= 0 and driver_net_minor >= 0
               and base_minor >= 0 and distance_minor >= 0 and time_minor >= 0),
    constraint ck_quote_route_non_negative check (distance_m >= 0 and duration_s >= 0),
    constraint ck_quote_commission_bp check (commission_bp between 0 and 9999),
    -- The two invariants of a price. The code derives them (FareCalculator), so a
    -- violation here can only mean a bug or a manual edit — both of which must fail
    -- loudly rather than reach a rider.
    constraint ck_quote_parts_sum check (base_minor + distance_minor + time_minor = price_minor),
    constraint ck_quote_split_sum check (driver_net_minor + commission_minor = price_minor),
    constraint ck_quote_expiry_after_creation check (expires_at > created_at)
);

-- The rider's quotes are read one at a time (by id, when ordering), and the expiry
-- sweep wants the date. A quote is the evidence of the price a rider agreed to, so it
-- is not deleted while the ride it produced is alive.
create index idx_quote_rider_created on trip.quote (rider_user_id, created_at desc);
create index idx_quote_expiry on trip.quote (expires_at);

-- ---------------------------------------------------------------------------
-- The ride.
-- ---------------------------------------------------------------------------

create table trip.trip (
    id                     varchar(26)  not null primary key,
    trip_number            varchar(32)  not null,
    -- One ride per key, forever. This unique index is the second line of defence behind
    -- the platform's idempotency store: Redis can be flushed or replaced, and a retried
    -- order must still not create a second ride (and a second reserved fare).
    idempotency_key        varchar(128) not null,
    quote_id               varchar(26)  not null,
    rider_user_id          varchar(64)  not null,
    rider_account_id       varchar(26),
    driver_id              varchar(26),
    driver_name            varchar(128),
    vehicle_plate          varchar(16),
    tariff                 varchar(16)  not null,
    status                 varchar(24)  not null,
    pickup_lat             double precision not null,
    pickup_lon             double precision not null,
    pickup_address         varchar(256),
    dropoff_lat            double precision not null,
    dropoff_lon            double precision not null,
    dropoff_address        varchar(256),
    distance_m             integer      not null,
    duration_s             integer      not null,
    price_minor            bigint       not null,
    commission_bp          integer      not null,
    commission_minor       bigint       not null,
    driver_net_minor       bigint       not null,
    base_minor             bigint       not null,
    distance_minor         bigint       not null,
    time_minor             bigint       not null,
    currency               varchar(3)   not null,
    surge_bp               integer      not null,
    -- The reservation of the fare, and what became of it. Tracked as a status rather
    -- than inferred from a non-null hold_id: a ride whose hold is ACTIVE but whose
    -- status is not ASSIGNED is exactly the state a retry has to resolve before it
    -- reserves a second time.
    hold_id                varchar(26),
    hold_status            varchar(16)  not null,
    capture_transaction_id varchar(26),
    cancel_reason          varchar(512),
    rating_stars           integer,
    rating_comment         varchar(512),
    rated_at               timestamptz,
    comment                varchar(512),
    requested_at           timestamptz  not null,
    assigned_at            timestamptz,
    arrived_at             timestamptz,
    started_at             timestamptz,
    completed_at           timestamptz,
    cancelled_at           timestamptz,
    updated_at             timestamptz  not null,
    version                bigint       not null default 0,

    constraint uq_trip_idempotency unique (idempotency_key),
    constraint uq_trip_number unique (trip_number),
    constraint ck_trip_status check (status in ('SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS',
                                               'COMPLETED', 'CANCELLED_BY_RIDER',
                                               'CANCELLED_BY_DRIVER', 'NO_DRIVERS_FOUND')),
    constraint ck_trip_tariff check (tariff in ('ECONOMY', 'COMFORT')),
    constraint ck_trip_hold_status check (hold_status in ('NONE', 'ACTIVE', 'CAPTURED', 'RELEASED')),
    constraint ck_trip_amounts_non_negative
        check (price_minor >= 0 and commission_minor >= 0 and driver_net_minor >= 0
               and base_minor >= 0 and distance_minor >= 0 and time_minor >= 0),
    constraint ck_trip_route_non_negative check (distance_m >= 0 and duration_s >= 0),
    constraint ck_trip_commission_bp check (commission_bp between 0 and 9999),
    -- The invariant the whole money design rests on: what the driver earns plus what the
    -- platform takes is exactly what the rider pays. Broken here, it is a bug that must
    -- stop a write, not a rounding difference somebody reconciles later.
    constraint ck_trip_split_sum check (driver_net_minor + commission_minor = price_minor),
    constraint ck_trip_parts_sum check (base_minor + distance_minor + time_minor = price_minor),
    -- A rating is 1..5 stars or absent; a rating on a ride that did not happen is
    -- refused by the aggregate, and this is the last line of defence against a manual edit.
    constraint ck_trip_rating_range check (rating_stars is null or rating_stars between 1 and 5),
    constraint ck_trip_rating_completed check (rating_stars is null or status = 'COMPLETED'),
    -- A trip with a driver has a driver name to show and vice versa: a half-written
    -- assignment is not a state anybody should have to handle downstream.
    constraint ck_trip_driver_consistency
        check ((driver_id is null and driver_name is null) or driver_id is not null),
    -- Money may only be captured or released through a hold that exists.
    constraint ck_trip_hold_consistency
        check (hold_status = 'NONE' or hold_id is not null)
);

-- The rider's history: "my rides, newest first".
create index idx_trip_rider_requested on trip.trip (rider_user_id, requested_at desc);
-- The dispatcher's board and the operator's filter: one status, newest first.
create index idx_trip_status_requested on trip.trip (status, requested_at desc);
-- The driver's own view and the driver-quality reports.
create index idx_trip_driver_requested on trip.trip (driver_id, requested_at desc);
-- Support asks "what happened to hold X" when a rider disputes a charge.
create index idx_trip_hold on trip.trip (hold_id) where hold_id is not null;
-- The sweep for rides that were closed but still hold money: cheap because it is partial.
create index idx_trip_active_hold on trip.trip (hold_status) where hold_status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- The history of a ride. Append-only: rows are never updated or deleted.
-- ---------------------------------------------------------------------------

create table trip.trip_transition (
    id           varchar(26)  not null primary key,
    trip_id      varchar(26)  not null,
    from_status  varchar(24),
    to_status    varchar(24)  not null,
    actor        varchar(32),
    reason       varchar(512),
    occurred_at  timestamptz  not null,

    constraint ck_trip_transition_to_status
        check (to_status in ('SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED',
                             'CANCELLED_BY_RIDER', 'CANCELLED_BY_DRIVER', 'NO_DRIVERS_FOUND')),
    constraint ck_trip_transition_from_status
        check (from_status is null or from_status in ('SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS',
                                                      'COMPLETED', 'CANCELLED_BY_RIDER',
                                                      'CANCELLED_BY_DRIVER', 'NO_DRIVERS_FOUND')),
    -- The timeline is read per ride, in order; the id breaks ties inside a millisecond.
    constraint fk_trip_transition_trip foreign key (trip_id) references trip.trip (id) on delete cascade
);

create index idx_trip_transition_trip on trip.trip_transition (trip_id, occurred_at, id);

-- ---------------------------------------------------------------------------
-- Platform infrastructure: the transactional outbox.
--
-- The entity lives in common-kafka (every service gets the same implementation), but
-- the table belongs to this service's schema: the relay publishes whatever this service
-- wrote, in the same transaction as the business change. Hibernate validates it at
-- startup, so a service without this table does not boot — which is the desired failure
-- mode, not an inconvenience.
-- ---------------------------------------------------------------------------

create table trip.outbox_message (
    id              varchar(26)  not null primary key,
    topic           varchar(128) not null,
    event_type      varchar(128) not null,
    aggregate_type  varchar(64)  not null,
    aggregate_id    varchar(64)  not null,
    partition_key   varchar(64)  not null,
    payload         text         not null,
    headers         text,
    status          varchar(16)  not null,
    attempts        integer      not null default 0,
    created_at      timestamptz  not null,
    published_at    timestamptz,
    last_error      text,
    version         bigint       not null default 0,
    constraint ck_outbox_status check (status in ('PENDING', 'PUBLISHED', 'FAILED'))
);

-- The relay query: oldest unpublished first, cheap to serve.
create index idx_outbox_pending on trip.outbox_message (status, created_at)
    where status <> 'PUBLISHED';
create index idx_outbox_aggregate on trip.outbox_message (aggregate_type, aggregate_id);
