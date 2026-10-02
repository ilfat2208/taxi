-- ---------------------------------------------------------------------------
-- Merchant settlement.
--
-- A marketplace owes its merchants money. Until now every captured merchant
-- payment simply stayed on the platform suspense account: the customer had paid,
-- the goods had shipped, and the debt existed only in someone's head.
--
-- Two facts are recorded here, and both are needed:
--   * merchant_settlement — what is owed for a period (the payable);
--   * settlement_payment  — which payments it covers (the audit trail).
-- Without the second table a merchant asking "what am I being paid for?" can only
-- be answered by re-deriving the period from timestamps, which drifts as soon as
-- anything is refunded or re-run.
-- ---------------------------------------------------------------------------

ALTER TABLE payment ADD COLUMN settled_at TIMESTAMPTZ;

COMMENT ON COLUMN payment.settled_at IS
    'when the payment was included in a merchant settlement; NULL means still owed';

-- The settlement query walks exactly this: completed merchant payments that are
-- still unsettled, in payout order. A partial index keeps it cheap on a table that
-- grows with every purchase.
CREATE INDEX idx_payment_unsettled ON payment (merchant_id, currency, completed_at)
    WHERE status = 'COMPLETED' AND settled_at IS NULL AND merchant_id IS NOT NULL;

CREATE TABLE merchant_settlement (
    id                  VARCHAR(26) PRIMARY KEY,
    settlement_number   VARCHAR(32)  NOT NULL,
    merchant_id         VARCHAR(26)  NOT NULL,
    -- Denormalised owner: a merchant must be able to list its own payouts without a
    -- call to the catalog service on every read.
    owner_user_id       VARCHAR(64)  NOT NULL,
    payout_account_id   VARCHAR(26),
    currency            VARCHAR(3)   NOT NULL,
    period_start        TIMESTAMPTZ  NOT NULL,
    period_end          TIMESTAMPTZ  NOT NULL,
    payment_count       INTEGER      NOT NULL,
    -- Customer paid total_minor per payment; the platform keeps fee_minor as its
    -- commission and owes the merchant amount_minor. gross + commission = paid.
    gross_minor         BIGINT       NOT NULL,
    commission_minor    BIGINT       NOT NULL,
    customer_paid_minor BIGINT       NOT NULL,
    net_minor           BIGINT       NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    -- merchant + currency + period_end: running the same period twice must produce
    -- the same settlement, never a second payout.
    idempotency_key     VARCHAR(128) NOT NULL,
    paid_at             TIMESTAMPTZ,
    failure_reason      VARCHAR(512),
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_settlement_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT uq_settlement_number UNIQUE (settlement_number),
    CONSTRAINT ck_settlement_gross_non_negative CHECK (gross_minor >= 0),
    CONSTRAINT ck_settlement_commission_non_negative CHECK (commission_minor >= 0),
    -- The arithmetic of a payout, enforced by the database: the merchant receives
    -- exactly the goods value, and the customer paid exactly goods + commission.
    CONSTRAINT ck_settlement_net CHECK (net_minor = gross_minor),
    CONSTRAINT ck_settlement_paid CHECK (customer_paid_minor = gross_minor + commission_minor),
    CONSTRAINT ck_settlement_period CHECK (period_end >= period_start),
    CONSTRAINT ck_settlement_status CHECK (status IN ('PENDING', 'PAID', 'FAILED'))
);

CREATE INDEX idx_settlement_merchant ON merchant_settlement (merchant_id, created_at DESC);
CREATE INDEX idx_settlement_owner ON merchant_settlement (owner_user_id, created_at DESC);
-- The payout job looks exactly here: what is still owed.
CREATE INDEX idx_settlement_payable ON merchant_settlement (status, created_at)
    WHERE status <> 'PAID';

-- Which payments a payout covers. payment_id is the primary key on purpose: a
-- payment can belong to exactly one settlement, so "settle the same sale twice" is
-- impossible even if the job is run concurrently by two replicas.
CREATE TABLE settlement_payment (
    payment_id          VARCHAR(26) PRIMARY KEY REFERENCES payment (id),
    settlement_id       VARCHAR(26) NOT NULL REFERENCES merchant_settlement (id),
    created_at          TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_settlement_payment_settlement ON settlement_payment (settlement_id);
