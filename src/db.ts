import { iso } from "./lib/time";

/**
 * The database, as typed functions.
 *
 * Every query the API runs lives here with its row type beside it, so a route never writes
 * SQL and a change to a table has one place to go. Instants are ISO UTC strings throughout;
 * SQLite compares them as text, which for this format is the same as comparing time.
 */

export type Tenant = {
  id: string;
  name: string;
  api_key_hash: string;
  payment_secret: string;
  created_at: string;
};
export type Resource = {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  slot_minutes: number;
  capacity: number;
  created_at: string;
};
export type Rule = {
  id: string;
  resource_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
};
export type BookingStatus = "held" | "confirmed" | "cancelled";
export type Booking = {
  id: string;
  tenant_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  hold_expires_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type Webhook = {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  events: string;
  active: number;
  created_at: string;
};
export type Delivery = {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  attempts: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
};

export const now = () => iso(new Date());
export const id = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function db(d1: D1Database) {
  return {
    tenantByKeyHash: (hash: string) =>
      d1.prepare("SELECT * FROM tenants WHERE api_key_hash = ?").bind(hash).first<Tenant>(),

    resources: (tenantId: string) =>
      d1
        .prepare("SELECT * FROM resources WHERE tenant_id = ? ORDER BY created_at")
        .bind(tenantId)
        .all<Resource>()
        .then((r) => r.results),

    resource: (tenantId: string, resourceId: string) =>
      d1
        .prepare("SELECT * FROM resources WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, resourceId)
        .first<Resource>(),

    createResource: async (r: Omit<Resource, "created_at">) => {
      await d1
        .prepare(
          "INSERT INTO resources (id, tenant_id, name, timezone, slot_minutes, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(r.id, r.tenant_id, r.name, r.timezone, r.slot_minutes, r.capacity, now())
        .run();
    },

    rules: (resourceId: string) =>
      d1
        .prepare(
          "SELECT * FROM availability_rules WHERE resource_id = ? ORDER BY weekday, start_minute",
        )
        .bind(resourceId)
        .all<Rule>()
        .then((r) => r.results),

    replaceRules: async (resourceId: string, rules: Omit<Rule, "id" | "resource_id">[]) => {
      const statements = [
        d1.prepare("DELETE FROM availability_rules WHERE resource_id = ?").bind(resourceId),
      ];
      for (const r of rules) {
        statements.push(
          d1
            .prepare(
              "INSERT INTO availability_rules (id, resource_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id("rule"), resourceId, r.weekday, r.start_minute, r.end_minute),
        );
      }
      await d1.batch(statements);
    },

    /** Bookings that take capacity in a window: confirmed, or held and not yet expired. */
    busy: (resourceId: string, from: string, to: string) =>
      d1
        .prepare(
          `SELECT * FROM bookings
           WHERE resource_id = ? AND starts_at < ? AND ends_at > ?
             AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))`,
        )
        .bind(resourceId, to, from, now())
        .all<Booking>()
        .then((r) => r.results),

    booking: (tenantId: string, bookingId: string) =>
      d1
        .prepare("SELECT * FROM bookings WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, bookingId)
        .first<Booking>(),

    bookings: (tenantId: string, resourceId?: string) =>
      d1
        .prepare(
          resourceId
            ? "SELECT * FROM bookings WHERE tenant_id = ? AND resource_id = ? ORDER BY starts_at DESC LIMIT 200"
            : "SELECT * FROM bookings WHERE tenant_id = ? ORDER BY starts_at DESC LIMIT 200",
        )
        .bind(...(resourceId ? [tenantId, resourceId] : [tenantId]))
        .all<Booking>()
        .then((r) => r.results),

    /**
     * Insert a booking only if capacity is still there — one statement, so two requests for
     * the last place cannot both win. SQLite runs the subquery and the insert atomically.
     */
    insertIfRoom: async (b: Omit<Booking, "created_at" | "updated_at">, capacity: number) => {
      const t = now();
      const result = await d1
        .prepare(
          `INSERT INTO bookings (id, tenant_id, resource_id, starts_at, ends_at, status, hold_expires_at, customer_name, customer_email, notes, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
           WHERE (
             SELECT COUNT(*) FROM bookings
             WHERE resource_id = ?3 AND starts_at < ?5 AND ends_at > ?4
               AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?11))
           ) < ?12`,
        )
        .bind(
          b.id,
          b.tenant_id,
          b.resource_id,
          b.starts_at,
          b.ends_at,
          b.status,
          b.hold_expires_at,
          b.customer_name,
          b.customer_email,
          b.notes,
          t,
          capacity,
        )
        .run();
      return (result.meta.changes ?? 0) > 0;
    },

    setStatus: async (bookingId: string, status: BookingStatus) => {
      await d1
        .prepare(
          "UPDATE bookings SET status = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(status, now(), bookingId)
        .run();
    },

    /** Holds past their expiry, which the cron turns into cancellations and events. */
    expiredHolds: () =>
      d1
        .prepare("SELECT * FROM bookings WHERE status = 'held' AND hold_expires_at <= ? LIMIT 100")
        .bind(now())
        .all<Booking>()
        .then((r) => r.results),

    idempotent: (tenantId: string, key: string) =>
      d1
        .prepare(
          "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE tenant_id = ? AND key = ?",
        )
        .bind(tenantId, key)
        .first<{ request_hash: string; response_status: number; response_body: string }>(),

    rememberIdempotent: async (
      tenantId: string,
      key: string,
      requestHash: string,
      status: number,
      body: string,
    ) => {
      await d1
        .prepare(
          "INSERT OR IGNORE INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(tenantId, key, requestHash, status, body, now())
        .run();
    },

    webhooks: (tenantId: string) =>
      d1
        .prepare("SELECT * FROM webhooks WHERE tenant_id = ? ORDER BY created_at")
        .bind(tenantId)
        .all<Webhook>()
        .then((r) => r.results),

    createWebhook: async (w: Omit<Webhook, "created_at" | "active">) => {
      await d1
        .prepare(
          "INSERT INTO webhooks (id, tenant_id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(w.id, w.tenant_id, w.url, w.secret, w.events, now())
        .run();
    },

    deleteWebhook: async (tenantId: string, webhookId: string) => {
      const r = await d1
        .prepare("DELETE FROM webhooks WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, webhookId)
        .run();
      return (r.meta.changes ?? 0) > 0;
    },

    enqueueDelivery: async (d: Pick<Delivery, "id" | "webhook_id" | "event" | "payload">) => {
      const t = now();
      await d1
        .prepare(
          "INSERT INTO webhook_deliveries (id, webhook_id, event, payload, attempts, next_attempt_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
        )
        .bind(d.id, d.webhook_id, d.event, d.payload, t, t)
        .run();
    },

    dueDeliveries: (limit = 50) =>
      d1
        .prepare(
          `SELECT d.*, w.url, w.secret FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
           WHERE d.delivered_at IS NULL AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= ? AND w.active = 1
           ORDER BY d.next_attempt_at LIMIT ?`,
        )
        .bind(now(), limit)
        .all<Delivery & { url: string; secret: string }>()
        .then((r) => r.results),

    deliveries: (tenantId: string) =>
      d1
        .prepare(
          `SELECT d.* FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
           WHERE w.tenant_id = ? ORDER BY d.created_at DESC LIMIT 50`,
        )
        .bind(tenantId)
        .all<Delivery>()
        .then((r) => r.results),

    recordAttempt: async (
      deliveryId: string,
      outcome: {
        status: number | null;
        error: string | null;
        delivered: boolean;
        nextAttemptAt: string | null;
      },
    ) => {
      await d1
        .prepare(
          `UPDATE webhook_deliveries
           SET attempts = attempts + 1, last_status = ?, last_error = ?, delivered_at = ?, next_attempt_at = ?
           WHERE id = ?`,
        )
        .bind(
          outcome.status,
          outcome.error,
          outcome.delivered ? now() : null,
          outcome.nextAttemptAt,
          deliveryId,
        )
        .run();
    },

    /** Records a payment; a second delivery of the same provider reference changes nothing. */
    recordPayment: async (p: {
      id: string;
      booking_id: string;
      provider_ref: string;
      amount_minor: number;
      currency: string;
      status: "succeeded" | "failed";
    }) => {
      const r = await d1
        .prepare(
          "INSERT OR IGNORE INTO payments (id, booking_id, provider_ref, amount_minor, currency, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(p.id, p.booking_id, p.provider_ref, p.amount_minor, p.currency, p.status, now())
        .run();
      return (r.meta.changes ?? 0) > 0;
    },

    payments: (bookingId: string) =>
      d1
        .prepare("SELECT * FROM payments WHERE booking_id = ? ORDER BY received_at")
        .bind(bookingId)
        .all<{
          id: string;
          provider_ref: string;
          amount_minor: number;
          currency: string;
          status: string;
          received_at: string;
        }>()
        .then((r) => r.results),
  };
}

export type Db = ReturnType<typeof db>;
