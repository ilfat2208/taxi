-- ---------------------------------------------------------------------------
-- Support access audit trail.
--
-- The JWT already carries a SUPPORT role, and AuthenticatedUser.canAccess(owner)
-- treats it as "may read somebody else's data". That is exactly the kind of
-- access that must never be invisible: an agent reading a stranger's merchant
-- profile, catalog or stock holds is the reason audit tables exist, and until
-- now the platform had no record of it at all.
--
-- One row per successful support read, written by the read itself:
--
--   actor_user_id  who looked (identity-service user id from the JWT subject)
--   action         stable action code, e.g. catalog.support.merchant.read
--   endpoint       HTTP method + path template, e.g. GET /api/v1/support/merchants/{merchantId}
--   resource_type  MERCHANT | PRODUCT | STOCK | RESERVATION — the kind of data returned
--   resource_id    the key of what was returned: a resource id, the collection key
--                  (a merchant whose catalog was listed) or the literal 'ALL' for an
--                  unfiltered scan; the action code says which of the three it is
--   correlation_id the request's X-Correlation-Id, so the row joins the logs of the
--                  whole call chain (truncated to 64 characters)
--   created_at     when the read was served
--
-- WHEN a row is written (chosen deliberately, see SupportAuditService):
-- * only on a read that returned data, and inside the same transaction as that
--   read, so "an audit row exists" and "the data was handed out" are the same
--   fact — a failed lookup writes nothing, because inventing a resource id for a
--   resource that does not exist would fill this table with guesses;
-- * a failed lookup is still visible in the HTTP 404 in the access logs, so the
--   exclusion costs no observability.
--
-- Reads of this table itself (GET /api/v1/support/audit, ADMIN only) are not
-- self-audited: that endpoint pages through this very table, and a page scan that
-- writes into the table it is scanning makes the trail unstable under its own
-- paging.
--
-- Rows are append-only: nothing in the service updates or deletes them.
-- ---------------------------------------------------------------------------

CREATE TABLE support_audit_record (
    id                  VARCHAR(26)  PRIMARY KEY,
    actor_user_id       VARCHAR(64)  NOT NULL,
    action              VARCHAR(64)  NOT NULL,
    endpoint            VARCHAR(160) NOT NULL,
    resource_type       VARCHAR(32)  NOT NULL,
    resource_id         VARCHAR(64)  NOT NULL,
    correlation_id      VARCHAR(64)  NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL
);

COMMENT ON TABLE support_audit_record IS
    'Append-only trail of support/ADMIN reads of merchant data; written in the same transaction as the read';

-- The endpoint's own filter (resourceType + resourceId) and the "who read what"
-- investigation both read newest-first, which is also the order the index provides.
CREATE INDEX idx_support_audit_resource ON support_audit_record (resource_type, resource_id, created_at DESC);
CREATE INDEX idx_support_audit_actor ON support_audit_record (actor_user_id, created_at DESC);
CREATE INDEX idx_support_audit_created ON support_audit_record (created_at DESC);
