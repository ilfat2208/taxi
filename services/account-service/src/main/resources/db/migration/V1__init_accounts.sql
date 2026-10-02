-- ---------------------------------------------------------------------------
-- account-service schema
--
-- Money lives here. Two rules shape the whole schema:
--   1. amounts are BIGINT minor units (tiyn) with an explicit currency column;
--   2. nothing is ever updated in place that represents a historical fact —
--      ledger_entry is append-only, and balances are a cached projection of it.
-- ---------------------------------------------------------------------------

CREATE TABLE account (
    id                  VARCHAR(26) PRIMARY KEY,
    owner_user_id       VARCHAR(64)  NOT NULL,
    owner_phone         VARCHAR(32),
    display_name        VARCHAR(128),
    type                VARCHAR(16)  NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    -- balance_minor is the ledger projection; held_minor is reserved for
    -- in-flight payments. available = balance_minor - held_minor, and both
    -- constraints below are enforced by the database, not only by the service.
    balance_minor       BIGINT       NOT NULL DEFAULT 0,
    held_minor          BIGINT       NOT NULL DEFAULT 0,
    version             BIGINT       NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    CONSTRAINT ck_account_balance_non_negative CHECK (type = 'SYSTEM' OR balance_minor >= 0),
    CONSTRAINT ck_account_held_non_negative CHECK (held_minor >= 0),
    -- SYSTEM accounts represent the outside world (money created by a top-up or
    -- settled away to a merchant), so they may carry a negative balance — that is
    -- exactly what double-entry calls an external counterparty. Customer wallets
    -- never can.
    CONSTRAINT ck_account_held_le_balance CHECK (type = 'SYSTEM' OR held_minor <= balance_minor),
    CONSTRAINT ck_account_type CHECK (type IN ('CUSTOMER', 'MERCHANT', 'SYSTEM'))
);

CREATE INDEX idx_account_owner ON account (owner_user_id);
CREATE UNIQUE INDEX uq_account_owner_currency_type
    ON account (owner_user_id, currency, type)
    WHERE status <> 'CLOSED';

-- The ledger is append-only. Every money movement writes two rows (debit and
-- credit) that sum to zero, which is what makes the books reconcilable:
--   SELECT currency, SUM(amount_minor) FROM ledger_entry ... -> must be 0
CREATE TABLE ledger_entry (
    id                  VARCHAR(26) PRIMARY KEY,
    transaction_id      VARCHAR(26)  NOT NULL,
    account_id          VARCHAR(26)  NOT NULL REFERENCES account (id),
    direction           VARCHAR(6)   NOT NULL,
    amount_minor        BIGINT       NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    balance_after_minor BIGINT       NOT NULL,
    operation           VARCHAR(32)  NOT NULL,
    reference_type      VARCHAR(32),
    reference_id        VARCHAR(64),
    description         VARCHAR(255),
    correlation_id      VARCHAR(64),
    created_at          TIMESTAMPTZ  NOT NULL,
    CONSTRAINT ck_ledger_direction CHECK (direction IN ('DEBIT', 'CREDIT')),
    CONSTRAINT ck_ledger_amount_positive CHECK (amount_minor > 0)
);

CREATE INDEX idx_ledger_account_created ON ledger_entry (account_id, created_at DESC);
CREATE INDEX idx_ledger_transaction ON ledger_entry (transaction_id);
CREATE INDEX idx_ledger_reference ON ledger_entry (reference_type, reference_id);

-- Funds reserved for an in-flight payment. A hold is the mechanism that lets a
-- saga say "these tenge are spoken for" without moving them yet.
CREATE TABLE account_hold (
    id                  VARCHAR(26) PRIMARY KEY,
    account_id          VARCHAR(26)  NOT NULL REFERENCES account (id),
    amount_minor        BIGINT       NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    reason              VARCHAR(255),
    reference_type      VARCHAR(32),
    reference_id        VARCHAR(64),
    idempotency_key     VARCHAR(128),
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT ck_hold_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT ck_hold_status CHECK (status IN ('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED'))
);

CREATE INDEX idx_hold_account_status ON account_hold (account_id, status);
-- One hold per (payment, account): a retried request cannot reserve twice.
CREATE UNIQUE INDEX uq_hold_reference ON account_hold (reference_type, reference_id, account_id)
    WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX uq_hold_idempotency ON account_hold (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Transactional outbox (identical DDL in every service that publishes events;
-- each service owns its own copy in its own schema).
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_message (
    id              VARCHAR(26) PRIMARY KEY,
    topic           VARCHAR(128) NOT NULL,
    event_type      VARCHAR(128) NOT NULL,
    aggregate_type  VARCHAR(64)  NOT NULL,
    aggregate_id    VARCHAR(64)  NOT NULL,
    partition_key   VARCHAR(64)  NOT NULL,
    payload         TEXT         NOT NULL,
    headers         TEXT,
    status          VARCHAR(16)  NOT NULL,
    attempts        INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL,
    published_at    TIMESTAMPTZ,
    last_error      TEXT,
    version         BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED'))
);

-- The relay query: oldest unpublished first, cheap to serve.
CREATE INDEX idx_outbox_pending ON outbox_message (status, created_at)
    WHERE status <> 'PUBLISHED';
CREATE INDEX idx_outbox_aggregate ON outbox_message (aggregate_type, aggregate_id);
