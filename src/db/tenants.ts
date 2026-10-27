import { iso } from "../lib/time";
import {
  id,
  now,
  type Queryable,
  type Tenant,
  type Resource,
  type Rule,
  type Booking,
} from "./shared";

/** Tenants and their sandboxes: who a key belongs to, seeding a sandbox, and clearing it out. */
export function tenantsQueries(d1: Queryable) {
  return {
    tenantByKeyHash: (hash: string) =>
      d1.prepare("SELECT * FROM tenants WHERE api_key_hash = ?").bind(hash).first<Tenant>(),

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
