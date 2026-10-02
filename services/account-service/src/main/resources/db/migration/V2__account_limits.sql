-- ---------------------------------------------------------------------------
-- V2: transaction limits and the usage they are measured against.
--
-- Why limits live here, next to the holds: a stolen card does not care about the
-- payment saga. Someone holding a device with a live session can move money at
-- machine speed, and the only control that reacts fast enough is a ceiling that
-- the wallet itself enforces. A limit checked in a front-end or in the payment
-- service is a suggestion; a limit checked inside the same transaction that
-- reserves the funds is a rule.
--
-- Note on the two tables: configuration (`account_limit`) is deliberately
-- separated from state (`limit_usage`). One is an operator decision and rarely
-- changes; the other is written on every hold and must never be able to rewrite
-- the rule it is measured against.
--
-- NOTE for a real deployment: a missing `account_limit` row means UNLIMITED, and
-- that is the safe default for a migration (an account that suddenly cannot pay
-- is a worse incident than one that can pay too much). Production must therefore
-- seed sensible defaults in this same migration — e.g.
--   INSERT INTO account_limit (id, account_id, "window", outgoing_limit_minor, currency, created_at, updated_at)
--   SELECT ..., a.id, 'DAILY', 500000, a.currency, now(), now() FROM account a;
-- plus a product rule for lowering them (a limit change must never strand money
-- a customer already committed). This service intentionally does not invent
-- those numbers: a default limit is a pricing decision, not a technical one.
-- ---------------------------------------------------------------------------

-- Outgoing limits, one row per (account, window). `outgoing_limit_minor` caps
-- how much value an account may commit to outgoing payments inside a window,
-- not what it may hold: the limit is applied when funds are reserved.
CREATE TABLE account_limit (
    id                   VARCHAR(26) PRIMARY KEY,
    account_id           VARCHAR(26)  NOT NULL REFERENCES account (id),
    -- `window` is a reserved word in PostgreSQL, so the identifier is quoted in
    -- every statement that touches it (DDL, indexes, JPA mapping). Renaming it to
    -- something like `limit_window` to avoid the quotes would make the schema
    -- harder to read than the quotes do.
    "window"             VARCHAR(16)  NOT NULL,
    -- Minor units (tiyn/cents) and an explicit currency: mixing a KZT limit with
    -- a USD account is a class of bug that must be impossible to express here.
    outgoing_limit_minor BIGINT       NOT NULL,
    currency             VARCHAR(3)   NOT NULL,
    created_at           TIMESTAMPTZ  NOT NULL,
    updated_at           TIMESTAMPTZ  NOT NULL,
    -- A limit of zero would mean "this account may never pay", which is what
    -- freezing the account is for; the service rejects it and so does the table.
    CONSTRAINT ck_account_limit_positive CHECK (outgoing_limit_minor > 0),
    CONSTRAINT ck_account_limit_window CHECK ("window" IN ('DAILY', 'MONTHLY'))
);

-- One limit per account and window: the service upserts against this index, and
-- it is the last line of defence if two operators race on the same account.
CREATE UNIQUE INDEX uq_account_limit_account_window ON account_limit (account_id, "window");

-- What has already been committed in a window.
--
-- Design choice (see AccountLimitGuard for the reasoning): this is a COUNTER
-- table maintained inside the same transaction that creates/releases a hold, not
-- a SUM derived from the ledger on every request. Deriving is exact by
-- construction, but it runs on the hot path (every payment) while the account
-- row is locked, and its cost grows with the number of ledger entries in the
-- window — the one query an attacker could use to slow every wallet down.
-- Counting is O(1) and cannot drift here because of two properties:
--   1. every counter mutation happens in the same transaction as the hold
--      mutation, so a rolled-back hold takes its counter change with it;
--   2. every mutation runs while the account row is locked (placeHold,
--      releaseHold and the expiry job all lock it first), so two concurrent
--      holds cannot lose an update.
-- The accepted risk is a future code path that mutates holds without going
-- through AccountLimitGuard; `limit_usage` can then be reconciled against
-- account_hold (ACTIVE + CAPTURED rows in the bucket), which is how a drift
-- would be detected rather than suspected.
--
-- One row per window bucket (`window_start`), so nothing has to be reset at
-- midnight: a new day simply gets a new row and yesterday's row is history.
CREATE TABLE limit_usage (
    id           VARCHAR(26) PRIMARY KEY,
    account_id   VARCHAR(26)  NOT NULL REFERENCES account (id),
    "window"     VARCHAR(16)  NOT NULL,
    -- First instant of the bucket: midnight UTC for DAILY, the 1st for MONTHLY.
    window_start TIMESTAMPTZ  NOT NULL,
    used_minor   BIGINT       NOT NULL DEFAULT 0,
    -- Currency of the account the usage belongs to; a limit and its usage must
    -- never be compared across currencies.
    currency     VARCHAR(3)   NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL,
    -- Releases subtract, so the constraint is the only thing standing between a
    -- double release and a negative "spent" figure that would silently widen the
    -- customer's limit.
    CONSTRAINT ck_limit_usage_non_negative CHECK (used_minor >= 0),
    CONSTRAINT ck_limit_usage_window CHECK ("window" IN ('DAILY', 'MONTHLY'))
);

-- The enforcement lookup: exactly one row per (account, window, bucket).
CREATE UNIQUE INDEX uq_limit_usage_bucket ON limit_usage (account_id, "window", window_start);
-- Lets a retention job drop buckets that no limit can refer to any more.
CREATE INDEX idx_limit_usage_window_start ON limit_usage (window_start);
