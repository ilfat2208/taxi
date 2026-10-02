-- ---------------------------------------------------------------------------
-- QTime: the calendar behind every service vertical.
--
-- Компания -> специалисты -> услуги -> расписание -> запись
--
-- The chain in `docs/orta.md` §3 is exactly this schema, and the shape of it is
-- the argument for the service existing at all: a salon, a СТО, a clinic and a
-- rental counter differ in what they sell, not in how a week is divided into
-- windows. Everything below is therefore deliberately vertical-neutral: there is
-- no "salon" table and no "car" column, only who works when, how long a service
-- takes and which windows are taken.
-- ---------------------------------------------------------------------------

create table qtime.company (
    id            varchar(26)  not null primary key,
    name          varchar(160) not null,
    category      varchar(24)  not null,
    city          varchar(64)  not null,
    address       varchar(255) not null,
    -- Coordinates as doubles, not money-like integers: the phone shows a pin, not
    -- a price, and 1e-6 degrees is already ~10 cm of ground.
    lat           double precision not null,
    lon           double precision not null,
    -- rating in basis points (50000 = 5.00), like everywhere else a number sits
    -- next to money
    rating_bp     integer      not null,
    reviews_count integer      not null,
    -- A company's own zone: "09:00" means 09:00 where the salon is, and a
    -- nationwide platform cannot borrow the server's clock.
    time_zone     varchar(64)  not null,
    status        varchar(16)  not null,
    created_at    timestamptz  not null,
    updated_at    timestamptz  not null,
    version       bigint       not null,

    constraint company_category_known
        check (category in ('BEAUTY', 'BARBERSHOP', 'AUTO', 'HEALTH', 'SERVICES')),
    constraint company_status_known
        check (status in ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    constraint company_rating_range check (rating_bp between 0 and 50000),
    constraint company_reviews_non_negative check (reviews_count >= 0),
    constraint company_lat_range check (lat between -90 and 90),
    constraint company_lon_range check (lon between -180 and 180)
);

-- The public list is "what is near me, best rated first": city is the cheapest of
-- those filters to serve, category the next.
create index company_city_category_idx on qtime.company (city, category);
create index company_rating_idx on qtime.company (rating_bp desc);

create table qtime.specialist (
    id               varchar(26)  not null primary key,
    company_id       varchar(26)  not null,
    full_name        varchar(128) not null,
    specialization   varchar(128) not null,
    rating_bp        integer      not null,
    experience_years integer      not null,
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null,
    version          bigint       not null,

    constraint specialist_rating_range check (rating_bp between 0 and 50000),
    constraint specialist_experience_range check (experience_years between 0 and 80),
    constraint specialist_company_fk
        foreign key (company_id) references qtime.company (id) on delete cascade
);

create index specialist_company_idx on qtime.specialist (company_id);

-- ---------------------------------------------------------------------------
-- Services.
--
-- `specialist_id` is nullable on purpose and means "any specialist of this
-- company can do it": a salon sells "маникюр с покрытием" as a company service,
-- while "наращивание ресниц" is personal to one master. Modeling it as a single
-- owner column (the alternative) would either duplicate the company offer per
-- master, or force every offer to belong to exactly one person; the company card
-- on the phone shows one list of services, and the check "may this specialist do
-- this service?" is the same either way.
-- ---------------------------------------------------------------------------

create table qtime.service_item (
    id               varchar(26)  not null primary key,
    company_id       varchar(26)  not null,
    -- null = offered by every specialist of the company
    specialist_id    varchar(26),
    name             varchar(160) not null,
    -- Duration drives the slot arithmetic: a 90-minute service does not fit in the
    -- 30 minutes before the lunch break, and that must fall out of the numbers.
    duration_minutes integer      not null,
    -- Price in minor units (tiyn for KZT) with its currency, never a float.
    price_minor      bigint       not null,
    currency         varchar(8)   not null,
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null,
    version          bigint       not null,

    constraint service_item_duration_range check (duration_minutes between 5 and 1440),
    constraint service_item_price_non_negative check (price_minor >= 0),
    constraint service_item_currency_known check (currency in ('KZT', 'USD', 'EUR', 'RUB')),
    constraint service_item_company_fk
        foreign key (company_id) references qtime.company (id) on delete cascade,
    constraint service_item_specialist_fk
        foreign key (specialist_id) references qtime.specialist (id) on delete cascade
);

create index service_item_company_idx on qtime.service_item (company_id);
create index service_item_specialist_idx on qtime.service_item (specialist_id);

-- ---------------------------------------------------------------------------
-- Working hours: the week, one row per day a specialist works.
--
-- Absence of a row IS the day off — there is no "работает: нет" column to keep in
-- sync with the rows, and no way for the two to disagree. A one-off closure is a
-- `schedule_exception`, not a hole punched in the recurring week.
-- ---------------------------------------------------------------------------

create table qtime.working_hours (
    id           varchar(26) not null primary key,
    specialist_id varchar(26) not null,
    -- ISO-8601 day of week: 1 = Monday ... 7 = Sunday
    day_of_week  integer     not null,
    start_time   time        not null,
    end_time     time        not null,
    break_start  time,
    break_end    time,
    created_at   timestamptz not null,
    updated_at   timestamptz not null,
    version      bigint      not null,

    constraint working_hours_day_range check (day_of_week between 1 and 7),
    constraint working_hours_window check (end_time > start_time),
    -- A break is either absent or a real interval inside the shift: a half-entered
    -- break would silently remove the wrong windows from the grid.
    constraint working_hours_break_complete
        check ((break_start is null) = (break_end is null)),
    constraint working_hours_break_inside check (
        break_start is null
        or (break_start >= start_time and break_end <= end_time and break_end > break_start)),
    -- one rule per day: two rows for Monday would give a specialist two shifts by
    -- accident rather than by intent
    constraint working_hours_day_unique unique (specialist_id, day_of_week),
    constraint working_hours_specialist_fk
        foreign key (specialist_id) references qtime.specialist (id) on delete cascade
);

create index working_hours_specialist_idx on qtime.working_hours (specialist_id);

-- ---------------------------------------------------------------------------
-- Schedule exceptions: vacation, a day off, an extra shift.
--
-- Written now although nothing in the UI sets them yet: the difference between
-- "every Monday 09:00-20:00" and "this Monday is a holiday" is the difference
-- between a calendar and a lie, and the slot query already reads this table.
-- ---------------------------------------------------------------------------

create table qtime.schedule_exception (
    id             varchar(26)  not null primary key,
    specialist_id  varchar(26)  not null,
    exception_date date         not null,
    kind           varchar(16)  not null,
    start_time     time,
    end_time       time,
    note           varchar(255),
    created_at     timestamptz  not null,
    updated_at     timestamptz  not null,
    version        bigint       not null,

    constraint schedule_exception_kind_known
        check (kind in ('VACATION', 'DAY_OFF', 'EXTRA_SHIFT')),
    -- An extra shift without hours says nothing; a vacation with hours says too much.
    constraint schedule_exception_extra_shift_hours check (
        (kind = 'EXTRA_SHIFT' and start_time is not null and end_time is not null and end_time > start_time)
        or (kind <> 'EXTRA_SHIFT' and start_time is null and end_time is null)),
    constraint schedule_exception_unique unique (specialist_id, exception_date),
    constraint schedule_exception_specialist_fk
        foreign key (specialist_id) references qtime.specialist (id) on delete cascade
);

create index schedule_exception_date_idx on qtime.schedule_exception (exception_date);

-- ---------------------------------------------------------------------------
-- Bookings: a claim on one window of one specialist.
--
-- The price and the duration are COPIED from the service, not referenced through
-- it: a receipt must show what the client was quoted, and re-pricing "маникюр" next
-- quarter must not rewrite what somebody paid in March. The same reason the
-- company name and address travel in the event payload.
-- ---------------------------------------------------------------------------

create table qtime.booking (
    id               varchar(26)  not null primary key,
    -- Human-readable code (QT-XXXXXXXX) that a client can read out on the phone.
    -- The id is a ULID and stays the technical key; the code is for people.
    code             varchar(16)  not null,
    client_user_id   varchar(64)  not null,
    company_id       varchar(26)  not null,
    specialist_id    varchar(26)  not null,
    service_id       varchar(26)  not null,
    status           varchar(24)  not null,
    starts_at        timestamptz  not null,
    ends_at          timestamptz  not null,
    duration_minutes integer      not null,
    price_minor      bigint       not null,
    currency         varchar(8)   not null,
    client_comment   varchar(500),
    cancel_reason    varchar(255),
    cancelled_at     timestamptz,
    created_at       timestamptz  not null,
    updated_at       timestamptz  not null,
    version          bigint       not null,

    constraint booking_status_known check (status in (
        'CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_COMPANY', 'COMPLETED', 'NO_SHOW')),
    constraint booking_interval check (ends_at > starts_at),
    constraint booking_duration_range check (duration_minutes between 5 and 1440),
    constraint booking_price_non_negative check (price_minor >= 0),
    constraint booking_currency_known check (currency in ('KZT', 'USD', 'EUR', 'RUB')),
    -- Cancelling without a time, or a time without a cancellation, is a half-written
    -- fact; the pair travels together.
    constraint booking_cancellation_complete check (
        (cancelled_at is null and cancel_reason is null)
        or (cancelled_at is not null and status in ('CANCELLED_BY_CLIENT', 'CANCELLED_BY_COMPANY'))),
    constraint booking_company_fk
        foreign key (company_id) references qtime.company (id),
    constraint booking_specialist_fk
        foreign key (specialist_id) references qtime.specialist (id),
    constraint booking_service_fk
        foreign key (service_id) references qtime.service_item (id)
);

-- The invariant the whole service rests on: **одно окно — одна запись**, and it is
-- held by the database, not by the code. Two customers tapping 15:30 at the same
-- moment both reach the INSERT, and exactly one of them wins; the loser gets
-- 409 SLOT_TAKEN instead of an overbooked master.
--
-- The index is PARTIAL (`where status = 'CONFIRMED'`) for two reasons: cancelling
-- frees the window without deleting history, and a shop that re-books a freed slot
-- does not have to rewrite the cancelled row.
--
-- Why not an EXCLUDE constraint on `tstzrange(starts_at, ends_at)` instead, which
-- would also forbid *overlapping* bookings that start at different times? Because
-- it needs the `btree_gist` extension, and installing an extension is a change to
-- the deployment (superuser, and impossible on some managed Postgres) that this
-- service must not require to boot. Interval safety without it comes from two
-- places: every candidate start is validated against the existing intervals in
-- `BookingApplicationService`, and concurrent bookings for one specialist are
-- serialized by a row lock on the specialist, so the check and the insert cannot
-- interleave. When the deployment can install `btree_gist`, the exclusion
-- constraint is a one-line migration and the belt-and-braces version of this file.
create unique index booking_slot_unique on qtime.booking (specialist_id, starts_at)
    where status = 'CONFIRMED';

create unique index booking_code_unique on qtime.booking (code);

-- "Мои записи" and the company calendar, newest first.
create index booking_client_idx on qtime.booking (client_user_id, starts_at desc);
create index booking_specialist_day_idx on qtime.booking (specialist_id, starts_at);
create index booking_company_idx on qtime.booking (company_id, starts_at);

-- ---------------------------------------------------------------------------
-- Platform infrastructure: the transactional outbox.
--
-- The entity lives in common-kafka (every service gets the same implementation),
-- but the table belongs to this service's schema: the relay publishes whatever
-- this service wrote, in the same transaction as the business change. Hibernate
-- validates it at startup, so a service without this table does not boot — which
-- is the desired failure mode, not an inconvenience.
-- ---------------------------------------------------------------------------

create table qtime.outbox_message (
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
create index idx_outbox_pending on qtime.outbox_message (status, created_at)
    where status <> 'PUBLISHED';
create index idx_outbox_aggregate on qtime.outbox_message (aggregate_type, aggregate_id);
