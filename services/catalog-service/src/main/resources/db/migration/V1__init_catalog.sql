-- ---------------------------------------------------------------------------
-- catalog-service schema
--
-- The marketplace side of the super-app. Inventory is modelled with
-- reservations rather than direct decrements:
--
--   on_hand  : physical stock the merchant claims to have
--   reserved : quantities held by checkouts that are still paying
--   available = on_hand - reserved
--
-- A checkout reserves, then either commits (paid) or releases (abandoned or
-- failed). Without this, an abandoned cart would permanently remove sellable
-- stock, and two simultaneous buyers could oversell the last unit.
-- ---------------------------------------------------------------------------

CREATE TABLE merchant (
    id                  VARCHAR(26) PRIMARY KEY,
    owner_user_id       VARCHAR(64)  NOT NULL,
    name                VARCHAR(160) NOT NULL,
    display_name        VARCHAR(160),
    phone               VARCHAR(32),
    email               VARCHAR(160),
    city                VARCHAR(80),
    status              VARCHAR(16)  NOT NULL,
    rating_basis_points INTEGER      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_merchant_owner UNIQUE (owner_user_id),
    CONSTRAINT ck_merchant_status CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
    CONSTRAINT ck_merchant_rating CHECK (rating_basis_points BETWEEN 0 AND 500)
);

CREATE INDEX idx_merchant_status ON merchant (status);

CREATE TABLE product (
    id                  VARCHAR(26) PRIMARY KEY,
    merchant_id         VARCHAR(26)  NOT NULL REFERENCES merchant (id),
    sku                 VARCHAR(64)  NOT NULL,
    title               VARCHAR(200) NOT NULL,
    description         TEXT,
    category            VARCHAR(64)  NOT NULL,
    brand               VARCHAR(120),
    currency            VARCHAR(3)   NOT NULL,
    price_minor         BIGINT       NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    attributes          TEXT,
    image_url           VARCHAR(512),
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    -- Full-text search column maintained by the database, so the service can
    -- never forget to update it. Stage 2 of the search roadmap is a dedicated
    -- index (Elasticsearch/OpenSearch); this keeps search real until then.
    search_vector       tsvector GENERATED ALWAYS AS (
                            to_tsvector('simple',
                                coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' ||
                                coalesce(category, '') || ' ' || coalesce(description, ''))
                        ) STORED,
    CONSTRAINT uq_product_merchant_sku UNIQUE (merchant_id, sku),
    CONSTRAINT ck_product_price_positive CHECK (price_minor > 0),
    CONSTRAINT ck_product_status CHECK (status IN ('DRAFT', 'ACTIVE', 'OUT_OF_STOCK', 'ARCHIVED'))
);

CREATE INDEX idx_product_merchant ON product (merchant_id);
CREATE INDEX idx_product_category_status ON product (category, status);
CREATE INDEX idx_product_price ON product (price_minor);
CREATE INDEX idx_product_search ON product USING GIN (search_vector);

CREATE TABLE stock (
    product_id          VARCHAR(26) PRIMARY KEY REFERENCES product (id),
    on_hand             INTEGER      NOT NULL DEFAULT 0,
    reserved            INTEGER      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT ck_stock_on_hand_non_negative CHECK (on_hand >= 0),
    CONSTRAINT ck_stock_reserved_non_negative CHECK (reserved >= 0),
    -- The database refuses to let a marketplace oversell.
    CONSTRAINT ck_stock_reserved_le_on_hand CHECK (reserved <= on_hand)
);

-- One reservation per (checkout, product). `order_id` is the idempotency anchor:
-- a retried checkout reservation finds the existing row instead of reserving twice.
CREATE TABLE stock_reservation (
    id                  VARCHAR(26) PRIMARY KEY,
    product_id          VARCHAR(26)  NOT NULL REFERENCES product (id),
    order_id            VARCHAR(26)  NOT NULL,
    quantity            INTEGER      NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uq_reservation_order_product UNIQUE (order_id, product_id),
    CONSTRAINT ck_reservation_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_reservation_status CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED'))
);

CREATE INDEX idx_reservation_product_status ON stock_reservation (product_id, status);
CREATE INDEX idx_reservation_order ON stock_reservation (order_id);

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
