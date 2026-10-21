-- Slot: a reservations API. One tenant per API key; resources with weekly availability in
-- their own time zone; bookings in UTC. Every instant stored is ISO 8601 UTC with a Z, so
-- string comparison is time comparison and SQLite's indexes do the work.

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- SHA-256 of the key; the key itself is shown once and never stored.
  api_key_hash TEXT NOT NULL UNIQUE,
  payment_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  -- IANA zone; availability rules are in this zone's wall-clock time.
  timezone TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  -- How many bookings may overlap. A room is 1; a class with ten places is 10.
  capacity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX resources_tenant ON resources(tenant_id);

-- When a resource is open, as minutes from local midnight on a weekday (0 = Sunday).
CREATE TABLE availability_rules (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  CHECK (end_minute > start_minute)
);
CREATE INDEX rules_resource ON availability_rules(resource_id, weekday);

-- A hold is a booking with a status of 'held' and an expiry. A confirmed booking is one a
-- payment or an explicit confirmation turned real. Both count against capacity until they
-- are cancelled or, for a hold, expire.
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  resource_id TEXT NOT NULL REFERENCES resources(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled')),
  hold_expires_at TEXT,
  customer_name TEXT,
  customer_email TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX bookings_resource_time ON bookings(resource_id, starts_at, ends_at);
CREATE INDEX bookings_tenant ON bookings(tenant_id, created_at);
CREATE INDEX bookings_holds ON bookings(status, hold_expires_at);

-- The same request twice gets the same answer: the first response is stored under the key.
CREATE TABLE idempotency_keys (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  url TEXT NOT NULL,
  -- Shared secret for the HMAC on every delivery.
  secret TEXT NOT NULL,
  -- JSON array of event names, or ["*"].
  events TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX webhooks_tenant ON webhooks(tenant_id);

-- Every attempt to deliver an event, with the schedule for the next one.
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  delivered_at TEXT,
  last_status INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX deliveries_due ON webhook_deliveries(next_attempt_at) WHERE delivered_at IS NULL;

-- A payment from the provider's webhook. The provider's reference is unique, which is what
-- makes a replayed webhook a no-op rather than a second confirmation.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  provider_ref TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  received_at TEXT NOT NULL
);
