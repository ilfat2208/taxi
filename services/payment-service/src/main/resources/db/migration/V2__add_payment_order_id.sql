-- ---------------------------------------------------------------------------
-- payment.order_id
--
-- V1 is frozen and has no column for the marketplace order a merchant payment
-- settles. The order id is not optional bookkeeping: order-service sends it with
-- every merchant payment, and the payment.* event payloads must carry it so the
-- order saga can be reconciled — including when a crashed payment is finished
-- later by the recovery job, long after the HTTP request that carried the id is
-- gone. Without persistence the id could only be published by luck (the event
-- written in the same millisecond as the request), which is exactly the kind of
-- "works until it doesn't" gap this service exists to avoid.
--
-- Nullable: only MERCHANT_PAYMENT rows have an order.
-- ---------------------------------------------------------------------------

ALTER TABLE payment ADD COLUMN order_id VARCHAR(26);

CREATE INDEX idx_payment_order ON payment (order_id) WHERE order_id IS NOT NULL;
