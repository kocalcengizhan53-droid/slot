import { iso } from "../lib/time";
import { now, type Queryable } from "./shared";

/** Idempotency keys: claimed before work starts, completed with the stored response, purged after a day. */
export function idempotencyQueries(d1: Queryable) {
  return {
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
  };
}
