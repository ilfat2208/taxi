-- ---------------------------------------------------------------------------
-- payment-service schema
--
-- A payment is a state machine, and this schema is designed so that the machine
-- can always be resumed: the current state, every transition it went through,
-- and the idempotency key that created it are all durable before any remote
-- call is made.
--
--   INITIATED -> PENDING -> COMPLETED
--                        -> FAILED
--              COMPLETED -> REVERSED (refund)
-- ---------------------------------------------------------------------------

CREATE TABLE payment (
    id                  VARCHAR(26) PRIMARY KEY,
    payment_number      VARCHAR(32)  NOT NULL,
    type                VARCHAR(24)  NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    -- Denormalised owner: "show me my payments" and the authorization check must
    -- not require a call to the account service on every read.
    owner_user_id       VARCHAR(64)  NOT NULL,
    source_account_id   VARCHAR(26),
    target_account_id   VARCHAR(26),
    merchant_id         VARCHAR(26),
    amount_minor        BIGINT       NOT NULL,
    fee_minor           BIGINT       NOT NULL DEFAULT 0,
    total_minor         BIGINT       NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    description         VARCHAR(255),
    -- The client-supplied key is a first-class column with a unique constraint:
    -- the database, not the service, is the final authority on "only once".
    idempotency_key     VARCHAR(128) NOT NULL,
    request_hash        VARCHAR(64)  NOT NULL,
    correlation_id      VARCHAR(64),
    failure_code        VARCHAR(64),
    failure_reason      VARCHAR(512),
    saga_state          VARCHAR(32),
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    completed_at        TIMESTAMPTZ,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_payment_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT uq_payment_number UNIQUE (payment_number),
    CONSTRAINT ck_payment_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT ck_payment_fee_non_negative CHECK (fee_minor >= 0),
    CONSTRAINT ck_payment_total CHECK (total_minor = amount_minor + fee_minor),
    CONSTRAINT ck_payment_type CHECK (type IN ('P2P_TRANSFER', 'MERCHANT_PAYMENT', 'TOP_UP', 'PAYOUT', 'REFUND')),
    CONSTRAINT ck_payment_status CHECK (status IN ('INITIATED', 'PENDING', 'COMPLETED', 'FAILED', 'REVERSED'))
);

CREATE INDEX idx_payment_owner_created ON payment (owner_user_id, created_at DESC);
CREATE INDEX idx_payment_source ON payment (source_account_id, created_at DESC);
CREATE INDEX idx_payment_target ON payment (target_account_id, created_at DESC);
CREATE INDEX idx_payment_merchant ON payment (merchant_id, created_at DESC);
CREATE INDEX idx_payment_status_created ON payment (status, created_at);
-- Reconciliation helper: every payment of a saga step is found by its reference.
CREATE INDEX idx_payment_correlation ON payment (correlation_id);

-- Append-only audit of the state machine. Never updated, never deleted: when a
-- payment is disputed, this table answers "who moved it and when".
CREATE TABLE payment_transition (
    id                  VARCHAR(26) PRIMARY KEY,
    payment_id          VARCHAR(26)  NOT NULL REFERENCES payment (id),
    from_status         VARCHAR(16),
    to_status           VARCHAR(16)  NOT NULL,
    reason              VARCHAR(512),
    actor               VARCHAR(64),
    created_at          TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_transition_payment ON payment_transition (payment_id, created_at);

-- Refunds reference the original payment and can never exceed it; the service
-- enforces the sum, the schema enforces the shape.
CREATE TABLE refund (
    id                  VARCHAR(26) PRIMARY KEY,
    payment_id          VARCHAR(26)  NOT NULL REFERENCES payment (id),
    amount_minor        BIGINT       NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    reason              VARCHAR(255),
    idempotency_key     VARCHAR(128) NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_refund_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT ck_refund_amount_positive CHECK (amount_minor > 0),
    CONSTRAINT ck_refund_status CHECK (status IN ('INITIATED', 'COMPLETED', 'FAILED'))
);

CREATE INDEX idx_refund_payment ON refund (payment_id);

-- ---------------------------------------------------------------------------
-- Transactional outbox (see account-service V1 for the rationale).
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

CREATE INDEX idx_outbox_pending ON outbox_message (status, created_at)
    WHERE status <> 'PUBLISHED';
CREATE INDEX idx_outbox_aggregate ON outbox_message (aggregate_type, aggregate_id);
