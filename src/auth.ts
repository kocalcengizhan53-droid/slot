import type { Context, MiddlewareHandler } from "hono";

import { now, sha256, type Db, type Tenant } from "./db";
import { problemBody, problem } from "./problem";

/**
 * Who is calling, how often, and whether we have seen this exact request before.
 */

export type Vars = { tenant: Tenant; db: Db; requestId: string };
export type AppEnv = { Bindings: Env; Variables: Vars };

/**
 * Key hash → tenant, remembered for half a minute per isolate. Most requests then skip the
 * lookup entirely; a deleted sandbox can answer for at most thirty seconds more, with no data
 * left behind it to read.
 */
const TENANTS = new Map<string, { tenant: Tenant; until: number }>();
const TENANT_TTL_MS = 30_000;

/**
 * Bearer API key → tenant. The key is hashed and looked up; the hash is the only thing the
 * database has ever held. A missing or unknown key is a 401 with a body that says which.
 */
export const apiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) return problem(c, 401, "unauthorized", "Send the API key as a Bearer token.");
  const hash = await sha256(key);
  const d = c.get("db");
  const cached = TENANTS.get(hash);
  let tenant = cached && cached.until > Date.now() ? cached.tenant : null;
  if (!tenant) {
    tenant = await d.tenantByKeyHash(hash);
    if (tenant) TENANTS.set(hash, { tenant, until: Date.now() + TENANT_TTL_MS });
  }
  if (!tenant) return problem(c, 401, "unauthorized", "That API key is not known.");
  if (tenant.expires_at !== null && tenant.expires_at <= now()) {
    TENANTS.delete(hash);
    return problem(
      c,
      401,
      "sandbox_expired",
      "This sandbox has expired. Create a new one: POST /v1/sandbox.",
    );
  }

  // Sixty a minute per key. The limiter is a Workers binding; nothing to run or scale.
  const { success } = await c.env.API_RATE.limit({ key: tenant.id });
  if (!success) {
    c.header("Retry-After", "60");
    return problem(c, 429, "rate_limited", "Sixty requests a minute per key. Try again shortly.");
  }

  c.set("tenant", tenant);
  await next();
};

/**
 * Idempotency for writes. With an `Idempotency-Key` header, the first request claims the key
 * before it runs and stores its response under it; every repeat gets that response back — the
 * same status, the same body, the same booking id — so a client that retried a timed-out POST
 * does not book twice. A repeat that arrives while the first is still running is a 409, not a
 * second execution. The same key with a different body is a 422: that is not a retry, it is a
 * mistake. Keys are kept for a day.
 */
export type Reply = { status: number; body: unknown; replayed?: boolean };

export async function idempotent(
  c: Context<AppEnv>,
  handler: () => Promise<Reply>,
): Promise<Reply> {
  const key = c.req.header("idempotency-key");
  if (!key) return handler();
  const d = c.get("db");
  const tenant = c.get("tenant");
  const requestHash = await sha256(`${c.req.method} ${c.req.path} ${await c.req.text()}`);
  if (!(await d.claimIdempotency(tenant.id, key, requestHash))) {
    const seen = await d.idempotency(tenant.id, key);
    if (seen && seen.request_hash !== requestHash) {
      return {
        status: 422,
        body: problemBody(
          c,
          422,
          "idempotency_mismatch",
          "This Idempotency-Key was used with a different request.",
        ),
      };
    }
    if (!seen || seen.response_status === null || seen.response_body === null) {
      return {
        status: 409,
        body: problemBody(
          c,
          409,
          "idempotency_in_progress",
          "The first request with this key has not finished. Retry in a moment.",
        ),
      };
    }
    return { status: seen.response_status, body: JSON.parse(seen.response_body), replayed: true };
  }
  try {
    const r = await handler();
    await d.completeIdempotency(tenant.id, key, r.status, JSON.stringify(r.body));
    return r;
  } catch (e) {
    // Nothing was stored, so the key is free for a genuine retry.
    await d.releaseIdempotency(tenant.id, key);
    throw e;
  }
}

/** HMAC-SHA256 over `${timestamp}.${body}`, hex — the signature on every outgoing webhook. */
export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two hex strings, so a wrong signature takes as long as a right one. */
export function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Parses `t=<unix>,v1=<hex>` and verifies it against the body, rejecting anything older than five minutes. */
export async function verifySignature(
  secret: string,
  header: string | undefined,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=") as [string, string]),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(nowSeconds - Number(t)) > 300) return false;
  return sameSignature(await sign(secret, t, body), v1);
}
