-- ---------------------------------------------------------------------------
-- Split payments: one payment per merchant of an order.
--
-- The payment contract has always been per merchant (payment.merchant_id) and
-- settlement groups by (merchant, currency), so a basket holding two sellers
-- cannot be paid with one payment without one of them losing their money.
-- Checkout therefore charges every merchant separately; this table is the
-- per-merchant state of that checkout.
--
-- One row per (order, merchant), written BEFORE the payment call for that
-- merchant and updated when the answer arrives:
--
--   amount_minor   what this merchant is charged: the sum of their lines, plus
--                  the order's delivery fee for the one merchant that carries it
--   fee_minor      the platform fee payment-service computed for this payment
--                  (basis points of the amount); 0 until it answers
--   total_minor    what the payer is debited: amount_minor + fee_minor
--   status         PENDING -> COMPLETED (money moved)
--                          -> FAILED    (refused, nothing moved)
--                  COMPLETED -> REFUNDED (compensated after another merchant
--                  refused: a partially paid order is never left standing)
--   payment_id     the payment service's id, needed to read and refund it
--
-- The order is PAID only when every row is COMPLETED; the rows are also what the
-- recovery job reads to resolve a checkout whose answer was lost, which is why
-- they are persisted before the remote call rather than after it.
--
-- Orders created before this migration have no rows: they carry a single payment
-- for the whole order total on customer_order.payment_id, and order-service keeps
-- resolving them that way.
-- ---------------------------------------------------------------------------

CREATE TABLE order_payment (
    id                  VARCHAR(26) PRIMARY KEY,
    order_id            VARCHAR(26)  NOT NULL REFERENCES customer_order (id) ON DELETE CASCADE,
    merchant_id         VARCHAR(26)  NOT NULL,
    amount_minor        BIGINT       NOT NULL,
    fee_minor           BIGINT       NOT NULL DEFAULT 0,
    total_minor         BIGINT       NOT NULL,
    currency            VARCHAR(3)   NOT NULL,
    status              VARCHAR(16)  NOT NULL,
    payment_id          VARCHAR(26),
    failure_code        VARCHAR(64),
    failure_reason      VARCHAR(512),
    created_at          TIMESTAMPTZ  NOT NULL,
    updated_at          TIMESTAMPTZ  NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    -- One payment per merchant: this is what makes a retried checkout resume the
    -- same charges instead of creating a second set of them.
    CONSTRAINT uq_order_payment_merchant UNIQUE (order_id, merchant_id),
    CONSTRAINT ck_order_payment_total CHECK (total_minor = amount_minor + fee_minor),
    CONSTRAINT ck_order_payment_amount CHECK (amount_minor > 0),
    CONSTRAINT ck_order_payment_fee CHECK (fee_minor >= 0),
    CONSTRAINT ck_order_payment_status CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'))
);

CREATE INDEX idx_order_payment_order ON order_payment (order_id);
-- The reconciliation path resolves an order from a payment id (an event that did
-- not name one) and reads the merchant's line by its own payment id.
CREATE INDEX idx_order_payment_payment ON order_payment (payment_id);
