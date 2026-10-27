import type { After } from "./page";
import { iso } from "./lib/time";

/**
 * The database, as typed functions.
 *
 * Every query the API runs lives here with its row type beside it, so a route never writes
 * SQL and a change to a table has one place to go. Instants are ISO UTC strings throughout;
 * SQLite compares them as text, which for this format is the same as comparing time.
 *
 * Requests run on a D1 session: reads go to the nearest replica that has caught up with
 * everything this client has written (the bookmark travels in a header), writes go to the
 * primary. Where a route needs several reads, they go in one batch — one round trip.
 */

export type Tenant = {
  id: string;
  name: string;
  api_key_hash: string;
  payment_secret: string;
  kind: "live" | "sandbox";
  expires_at: string | null;
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

/** A database or a session on one: both prepare and batch. */
export type Queryable = Pick<D1Database, "prepare" | "batch">;

/** Bookings that take capacity: confirmed, or held and not yet expired. */
const LIVE = "(status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))";

export function db(d1: Queryable) {
  const rules = (resourceId: string) =>
    d1
      .prepare(
        "SELECT * FROM availability_rules WHERE resource_id = ? ORDER BY weekday, start_minute",
      )
      .bind(resourceId);

  return {
    tenantByKeyHash: (hash: string) =>
      d1.prepare("SELECT * FROM tenants WHERE api_key_hash = ?").bind(hash).first<Tenant>(),

    resources: (tenantId: string, limit: number, after: After | null) =>
      d1
        .prepare(
          `SELECT * FROM resources WHERE tenant_id = ?1
             AND (?2 IS NULL OR created_at > ?2 OR (created_at = ?2 AND id > ?3))
           ORDER BY created_at, id LIMIT ?4`,
        )
        .bind(tenantId, after?.sort ?? null, after?.id ?? null, limit + 1)
        .all<Resource>()
        .then((r) => r.results),

    resource: (tenantId: string, resourceId: string) =>
      d1
        .prepare("SELECT * FROM resources WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, resourceId)
        .first<Resource>(),

    countResources: (tenantId: string) =>
      d1
        .prepare("SELECT COUNT(*) AS n FROM resources WHERE tenant_id = ?")
        .bind(tenantId)
        .first<number>("n"),

    createResource: async (r: Omit<Resource, "created_at">) => {
      const created = { ...r, created_at: now() };
      await d1
        .prepare(
          "INSERT INTO resources (id, tenant_id, name, timezone, slot_minutes, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(r.id, r.tenant_id, r.name, r.timezone, r.slot_minutes, r.capacity, created.created_at)
        .run();
      return created;
    },

    rules: (resourceId: string) =>
      rules(resourceId)
        .all<Rule>()
        .then((r) => r.results),

    replaceRules: async (resourceId: string, next: Omit<Rule, "id" | "resource_id">[]) => {
      await d1.batch([
        d1.prepare("DELETE FROM availability_rules WHERE resource_id = ?").bind(resourceId),
        ...next.map((r) =>
          d1
            .prepare(
              "INSERT INTO availability_rules (id, resource_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id("rule"), resourceId, r.weekday, r.start_minute, r.end_minute),
        ),
      ]);
    },

    /**
     * Everything availability and booking need, in one round trip: the resource (scoped to the
     * tenant), its rules, the bookings that take capacity in the window, and the tenant's
     * booking count for the sandbox quota. Rules and bookings are filtered through the
     * resource's tenant, so a foreign id returns nothing at all.
     */
    slotInputs: async (tenantId: string, resourceId: string, from: string, to: string) => {
      const t = now();
      const [resource, ruleRows, busy, count] = await d1.batch([
        d1
          .prepare("SELECT * FROM resources WHERE tenant_id = ? AND id = ?")
          .bind(tenantId, resourceId),
        d1
          .prepare(
            `SELECT a.* FROM availability_rules a JOIN resources r ON r.id = a.resource_id
             WHERE r.tenant_id = ? AND a.resource_id = ? ORDER BY a.weekday, a.start_minute`,
          )
          .bind(tenantId, resourceId),
        d1
          .prepare(
            `SELECT * FROM bookings WHERE tenant_id = ? AND resource_id = ? AND starts_at < ? AND ends_at > ? AND ${LIVE}`,
          )
          .bind(tenantId, resourceId, to, from, t),
        d1.prepare("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ?").bind(tenantId),
      ]);
      return {
        resource: (resource.results[0] as Resource | undefined) ?? null,
        rules: ruleRows.results as Rule[],
        busy: busy.results as Booking[],
        bookingCount: (count.results[0] as { n: number }).n,
      };
    },

    booking: (tenantId: string, bookingId: string) =>
      d1
        .prepare("SELECT * FROM bookings WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, bookingId)
        .first<Booking>(),

    /** Newest first by start time. */
    bookings: (tenantId: string, resourceId: string | null, limit: number, after: After | null) =>
      d1
        .prepare(
          `SELECT * FROM bookings WHERE tenant_id = ?1 AND (?2 IS NULL OR resource_id = ?2)
             AND (?3 IS NULL OR starts_at < ?3 OR (starts_at = ?3 AND id < ?4))
           ORDER BY starts_at DESC, id DESC LIMIT ?5`,
        )
        .bind(tenantId, resourceId, after?.sort ?? null, after?.id ?? null, limit + 1)
        .all<Booking>()
        .then((r) => r.results),

    /**
     * Insert a booking only if capacity is still there — one statement, so two requests for
     * the last place cannot both win. SQLite runs the subquery and the insert atomically.
     * Returns the row as stored, or null when the slot filled first.
     */
    insertIfRoom: async (
      b: Omit<Booking, "created_at" | "updated_at">,
      capacity: number,
    ): Promise<Booking | null> => {
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
      return (result.meta.changes ?? 0) > 0 ? { ...b, created_at: t, updated_at: t } : null;
    },

    /** Returns the update time it wrote. */
    setStatus: async (bookingId: string, status: BookingStatus) => {
      const t = now();
      await d1
        .prepare(
          "UPDATE bookings SET status = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(status, t, bookingId)
        .run();
      return t;
    },

    /** Holds past their expiry, which the cron turns into cancellations and events. */
    expiredHolds: () =>
      d1
        .prepare("SELECT * FROM bookings WHERE status = 'held' AND hold_expires_at <= ? LIMIT 100")
        .bind(now())
        .all<Booking>()
        .then((r) => r.results),

    /**
     * Claims an idempotency key before the request runs. True means this request owns it; false
     * means another request has it — finished, still running, or with a different body. A key
     * older than a day is reclaimed as if it were new.
     */
    claimIdempotency: async (tenantId: string, key: string, requestHash: string) => {
      const t = now();
      const r = await d1
        .prepare(
          `INSERT INTO idempotency_keys (tenant_id, key, request_hash, created_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (tenant_id, key) DO UPDATE
             SET request_hash = excluded.request_hash, response_status = NULL, response_body = NULL, created_at = excluded.created_at
             WHERE idempotency_keys.created_at < ?5`,
        )
        .bind(tenantId, key, requestHash, t, iso(new Date(Date.now() - 24 * 3_600_000)))
        .run();
      return (r.meta.changes ?? 0) > 0;
    },

    idempotency: (tenantId: string, key: string) =>
      d1
        .prepare(
          "SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE tenant_id = ? AND key = ?",
        )
        .bind(tenantId, key)
        .first<{
          request_hash: string;
          response_status: number | null;
          response_body: string | null;
        }>(),

    completeIdempotency: async (tenantId: string, key: string, status: number, body: string) => {
      await d1
        .prepare(
          "UPDATE idempotency_keys SET response_status = ?, response_body = ? WHERE tenant_id = ? AND key = ?",
        )
        .bind(status, body, tenantId, key)
        .run();
    },

    releaseIdempotency: async (tenantId: string, key: string) => {
      await d1
        .prepare("DELETE FROM idempotency_keys WHERE tenant_id = ? AND key = ?")
        .bind(tenantId, key)
        .run();
    },

    purgeIdempotency: () =>
      d1
        .prepare("DELETE FROM idempotency_keys WHERE created_at < ?")
        .bind(iso(new Date(Date.now() - 24 * 3_600_000)))
        .run(),

    /** With the owning tenant's kind, which decides whether delivery quotas apply. */
    webhooks: (tenantId: string) =>
      d1
        .prepare(
          `SELECT w.*, t.kind AS tenant_kind FROM webhooks w JOIN tenants t ON t.id = w.tenant_id
           WHERE w.tenant_id = ? ORDER BY w.created_at, w.id`,
        )
        .bind(tenantId)
        .all<Webhook & { tenant_kind: Tenant["kind"] }>()
        .then((r) => r.results),

    createWebhook: async (w: Omit<Webhook, "created_at" | "active">) => {
      const created = { ...w, active: 1, created_at: now() };
      await d1
        .prepare(
          "INSERT INTO webhooks (id, tenant_id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
        )
        .bind(w.id, w.tenant_id, w.url, w.secret, w.events, created.created_at)
        .run();
      return created;
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

    countDeliveries: (tenantId: string) =>
      d1
        .prepare(
          "SELECT COUNT(*) AS n FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE w.tenant_id = ?",
        )
        .bind(tenantId)
        .first<number>("n"),

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

    /** Newest first. */
    deliveries: (tenantId: string, limit: number, after: After | null) =>
      d1
        .prepare(
          `SELECT d.* FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
           WHERE w.tenant_id = ?1 AND (?2 IS NULL OR d.created_at < ?2 OR (d.created_at = ?2 AND d.id < ?3))
           ORDER BY d.created_at DESC, d.id DESC LIMIT ?4`,
        )
        .bind(tenantId, after?.sort ?? null, after?.id ?? null, limit + 1)
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

    /** The booking a payment event names, with the secret its tenant signs payments with. */
    bookingForPayment: (bookingId: string) =>
      d1
        .prepare(
          "SELECT b.*, t.payment_secret FROM bookings b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = ?",
        )
        .bind(bookingId)
        .first<Booking & { payment_secret: string }>(),

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

    liveSandboxes: () =>
      d1
        .prepare("SELECT COUNT(*) AS n FROM tenants WHERE kind = 'sandbox' AND expires_at > ?")
        .bind(now())
        .first<number>("n"),

    /** A sandbox tenant and its starting data, in one transaction. */
    createSandbox: async (seed: {
      tenant: Omit<Tenant, "created_at">;
      resources: Omit<Resource, "created_at" | "tenant_id">[];
      rules: Omit<Rule, "id">[];
      bookings: Omit<Booking, "created_at" | "updated_at" | "tenant_id">[];
    }) => {
      const t = now();
      const tid = seed.tenant.id;
      await d1.batch([
        d1
          .prepare(
            "INSERT INTO tenants (id, name, api_key_hash, payment_secret, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            tid,
            seed.tenant.name,
            seed.tenant.api_key_hash,
            seed.tenant.payment_secret,
            seed.tenant.kind,
            seed.tenant.expires_at,
            t,
          ),
        ...seed.resources.map((r, i) =>
          d1
            .prepare(
              "INSERT INTO resources (id, tenant_id, name, timezone, slot_minutes, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            // A second apart, so the list keeps the seed's order.
            .bind(
              r.id,
              tid,
              r.name,
              r.timezone,
              r.slot_minutes,
              r.capacity,
              iso(new Date(Date.parse(t) + i * 1000)),
            ),
        ),
        ...seed.rules.map((r) =>
          d1
            .prepare(
              "INSERT INTO availability_rules (id, resource_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id("rule"), r.resource_id, r.weekday, r.start_minute, r.end_minute),
        ),
        ...seed.bookings.map((b) =>
          d1
            .prepare(
              `INSERT INTO bookings (id, tenant_id, resource_id, starts_at, ends_at, status, hold_expires_at, customer_name, customer_email, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              b.id,
              tid,
              b.resource_id,
              b.starts_at,
              b.ends_at,
              b.status,
              b.hold_expires_at,
              b.customer_name,
              b.customer_email,
              b.notes,
              t,
              t,
            ),
        ),
      ]);
    },

    expiredSandboxes: (limit = 25) =>
      d1
        .prepare("SELECT id FROM tenants WHERE kind = 'sandbox' AND expires_at <= ? LIMIT ?")
        .bind(now(), limit)
        .all<{ id: string }>()
        .then((r) => r.results.map((x) => x.id)),

    /** Deletes a tenant and everything it owns, children first, in one transaction. */
    purgeTenant: async (tenantId: string) => {
      await d1.batch(
        [
          "DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE tenant_id = ?)",
          "DELETE FROM webhook_deliveries WHERE webhook_id IN (SELECT id FROM webhooks WHERE tenant_id = ?)",
          "DELETE FROM webhooks WHERE tenant_id = ?",
          "DELETE FROM bookings WHERE tenant_id = ?",
          "DELETE FROM availability_rules WHERE resource_id IN (SELECT id FROM resources WHERE tenant_id = ?)",
          "DELETE FROM resources WHERE tenant_id = ?",
          "DELETE FROM idempotency_keys WHERE tenant_id = ?",
          "DELETE FROM tenants WHERE id = ?",
        ].map((sql) => d1.prepare(sql).bind(tenantId)),
      );
    },
  };
}

export type Db = ReturnType<typeof db>;
