-- ---------------------------------------------------------------------------
-- order-service schema
--
-- A checkout is a saga, so the order row carries the state of the whole
-- orchestration, and every step is written down before the next remote call:
--
--   DRAFT -> PENDING_PAYMENT -> PAID -> CONFIRMED
--                            -> CANCELLED (stock released, payment failed)
--                            -> FAILED
--
-- `customer_order` rather than `order`: ORDER is a reserved word in SQL, and a
-- table that needs quoting in every query is a tax on every future reader.
-- ---------------------------------------------------------------------------

CREATE TABLE cart (
    id                  VARCHAR(26) PRIMARY KEY,
    user_id             VARCHAR(64)  NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT ck_cart_status CHECK (status IN ('ACTIVE', 'CHECKED_OUT', 'ABANDONED'))
);

-- One active cart per user: a customer who taps "cart" twice must not end up
-- with two carts holding different items.
CREATE UNIQUE INDEX uq_cart_active_user ON cart (user_id) WHERE status = 'ACTIVE';

CREATE TABLE cart_item (
    id                  VARCHAR(26) PRIMARY KEY,
    cart_id             VARCHAR(26)  NOT NULL REFERENCES cart (id) ON DELETE CASCADE,
    product_id          VARCHAR(26)  NOT NULL,
    merchant_id         VARCHAR(26)  NOT NULL,
    title               VARCHAR(200) NOT NULL,
    image_url           VARCHAR(512),
    unit_price_minor    BIGINT       NOT NULL,
    quantity            INTEGER      NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    CONSTRAINT uq_cart_item_product UNIQUE (cart_id, product_id),
    CONSTRAINT ck_cart_item_quantity CHECK (quantity > 0),
    CONSTRAINT ck_cart_item_price CHECK (unit_price_minor > 0)
);

CREATE INDEX idx_cart_item_cart ON cart_item (cart_id);

CREATE TABLE customer_order (
    id                  VARCHAR(26) PRIMARY KEY,
    order_number        VARCHAR(32)  NOT NULL,
    user_id             VARCHAR(64)  NOT NULL,
    status              VARCHAR(24)  NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    subtotal_minor      BIGINT       NOT NULL,
    delivery_fee_minor  BIGINT       NOT NULL DEFAULT 0,
    total_minor         BIGINT       NOT NULL,
    payment_id          VARCHAR(26),
    payment_status      VARCHAR(24),
    delivery_address    VARCHAR(512),
    contact_phone       VARCHAR(32),
    comment             VARCHAR(512),
    idempotency_key     VARCHAR(128) NOT NULL,
    request_hash        VARCHAR(64)  NOT NULL,
    saga_state          VARCHAR(32),
    failure_reason      VARCHAR(512),
    correlation_id      VARCHAR(64),
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    paid_at             TIMESTAMPTZ,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_order_number UNIQUE (order_number),
    CONSTRAINT uq_order_idempotency_key UNIQUE (idempotency_key),
    CONSTRAINT ck_order_total CHECK (total_minor = subtotal_minor + delivery_fee_minor),
    CONSTRAINT ck_order_subtotal_positive CHECK (subtotal_minor > 0),
    CONSTRAINT ck_order_status CHECK (status IN
        ('DRAFT', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'CANCELLED', 'FAILED'))
);

CREATE INDEX idx_order_user_created ON customer_order (user_id, created_at DESC);
CREATE INDEX idx_order_status_created ON customer_order (status, created_at);
CREATE INDEX idx_order_payment ON customer_order (payment_id);

CREATE TABLE order_item (
    id                  VARCHAR(26) PRIMARY KEY,
    order_id            VARCHAR(26)  NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    product_id          VARCHAR(26)  NOT NULL,
    merchant_id         VARCHAR(26)  NOT NULL,
    title               VARCHAR(200) NOT NULL,
    unit_price_minor    BIGINT       NOT NULL,
    quantity            INTEGER      NOT NULL,
    line_total_minor    BIGINT       NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    CONSTRAINT ck_order_item_quantity CHECK (quantity > 0),
    CONSTRAINT ck_order_item_line_total CHECK (line_total_minor = unit_price_minor * quantity)
);

CREATE INDEX idx_order_item_order ON order_item (order_id);
CREATE INDEX idx_order_item_product ON order_item (product_id);

-- Saga audit trail: each step, its outcome and its compensation.
CREATE TABLE order_status_history (
    id                  VARCHAR(26) PRIMARY KEY,
    order_id            VARCHAR(26)  NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    from_status         VARCHAR(24),
    to_status           VARCHAR(24)  NOT NULL,
    reason              VARCHAR(512),
    actor               VARCHAR(64),
    created_at          TIMESTAMPTZ  NOT NULL
);

CREATE INDEX idx_order_history_order ON order_status_history (order_id, created_at);

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
