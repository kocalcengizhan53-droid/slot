-- Sandboxes, cursor pagination, race-safe idempotency, and a latency histogram.

-- A sandbox is a tenant a visitor gets for a day, with its own key and its own data. Live
-- tenants never expire.
ALTER TABLE tenants ADD COLUMN kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live', 'sandbox'));
ALTER TABLE tenants ADD COLUMN expires_at TEXT;
CREATE INDEX tenants_expiry ON tenants(expires_at) WHERE expires_at IS NOT NULL;

-- Lists page by (starts_at, id), newest first.
CREATE INDEX bookings_tenant_start ON bookings(tenant_id, starts_at, id);

-- The first request under a key now claims it before it runs, so two concurrent requests with
-- the same key cannot both execute. A claimed key has no response yet. Keys live for a day.
DROP TABLE idempotency_keys;
CREATE TABLE idempotency_keys (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX idempotency_age ON idempotency_keys(created_at);

-- Server time per operation, in five-minute windows, as a histogram: b00 counts requests up
-- to 2 ms, b16 everything over 2 s (bounds in src/latency.ts). Percentiles are read from the
-- buckets, so the table stays one row per operation per window however busy it gets.
CREATE TABLE latency (
  period TEXT NOT NULL,
  operation TEXT NOT NULL,
  count INTEGER NOT NULL,
  b00 INTEGER NOT NULL DEFAULT 0, b01 INTEGER NOT NULL DEFAULT 0, b02 INTEGER NOT NULL DEFAULT 0,
  b03 INTEGER NOT NULL DEFAULT 0, b04 INTEGER NOT NULL DEFAULT 0, b05 INTEGER NOT NULL DEFAULT 0,
  b06 INTEGER NOT NULL DEFAULT 0, b07 INTEGER NOT NULL DEFAULT 0, b08 INTEGER NOT NULL DEFAULT 0,
  b09 INTEGER NOT NULL DEFAULT 0, b10 INTEGER NOT NULL DEFAULT 0, b11 INTEGER NOT NULL DEFAULT 0,
  b12 INTEGER NOT NULL DEFAULT 0, b13 INTEGER NOT NULL DEFAULT 0, b14 INTEGER NOT NULL DEFAULT 0,
  b15 INTEGER NOT NULL DEFAULT 0, b16 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period, operation)
);

-- The shared demo tenant's key was published in the repository and opened one dataset to
-- everyone. Visitors get their own sandbox now; retire it.
DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE tenant_id = 'ten_demo');
DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE tenant_id = 'ten_demo');
DELETE FROM webhooks WHERE tenant_id = 'ten_demo';
DELETE FROM bookings WHERE tenant_id = 'ten_demo';
DELETE FROM availability_rules WHERE resource_id IN (SELECT id FROM resources WHERE tenant_id = 'ten_demo');
DELETE FROM resources WHERE tenant_id = 'ten_demo';
DELETE FROM tenants WHERE id = 'ten_demo';
