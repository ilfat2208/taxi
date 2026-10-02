-- ---------------------------------------------------------------------------
-- Drivers: who is allowed to take trips.
--
-- A driver is a platform user with the DRIVER role plus a profile the platform
-- can vouch for. Documents are rows, not columns, because every one of them has
-- its own expiry date and "whose medical check runs out this week" must be an
-- index scan rather than a spreadsheet.
-- ---------------------------------------------------------------------------

create table driver.driver (
    id                varchar(26)  not null primary key,
    user_id           varchar(64)  not null,
    phone             varchar(32)  not null,
    display_name      varchar(128) not null,
    status            varchar(16)  not null,
    -- rating in basis points (50000 = 5.00): integers, like every other number
    -- that a customer sees next to money
    rating_bp         integer      not null,
    completed_trips   integer      not null,
    current_trip_id   varchar(26),
    created_at        timestamptz  not null,
    updated_at        timestamptz  not null,
    version           bigint       not null,

    constraint driver_status_known check (status in ('OFFLINE', 'ONLINE', 'BUSY')),
    constraint driver_rating_range check (rating_bp between 0 and 50000),
    -- one profile per platform user: registering twice is a client bug, not a
    -- second driver
    constraint driver_user_unique unique (user_id)
);

-- Dispatch asks for available drivers constantly; this partial index keeps that
-- query from scanning drivers who are off duty (the majority, most of the time).
create index driver_available_idx on driver.driver (status) where status = 'ONLINE';

create table driver.driver_document (
    id          varchar(26) not null primary key,
    driver_id   varchar(26) not null,
    kind        varchar(32) not null,
    expires_at  timestamptz not null,
    created_at  timestamptz not null,
    updated_at  timestamptz not null,

    constraint driver_document_kind_known
        check (kind in ('DRIVING_LICENCE', 'VEHICLE_INSPECTION', 'MEDICAL_CHECK')),
    -- only the current document of each kind is stored; renewing updates the
    -- expiry date, so no reader has to guess which row is "the latest"
    constraint driver_document_kind_unique unique (driver_id, kind),
    constraint driver_document_driver_fk
        foreign key (driver_id) references driver.driver (id) on delete cascade
);

-- The operational question is "what expires soon", so the index is on the date.
create index driver_document_expiry_idx on driver.driver_document (expires_at);

-- ---------------------------------------------------------------------------
-- Platform infrastructure: the transactional outbox.
--
-- The entity lives in common-kafka (every service gets the same implementation),
-- but the table belongs to this service's schema: the relay publishes whatever
-- this service wrote, in the same transaction as the business change. Hibernate
-- validates it at startup, so a service without this table does not boot — which
-- is the desired failure mode, not an inconvenience.
-- ---------------------------------------------------------------------------

create table driver.outbox_message (
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
create index idx_outbox_pending on driver.outbox_message (status, created_at)
    where status <> 'PUBLISHED';
create index idx_outbox_aggregate on driver.outbox_message (aggregate_type, aggregate_id);

