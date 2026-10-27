import type { After } from "../page";
import { now, type Queryable, type Tenant, type Webhook, type Delivery } from "./shared";

/** Webhook endpoints and their delivery queue. */
export function webhooksQueries(d1: Queryable) {
  return {
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
  };
}
