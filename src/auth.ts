import type { Context, MiddlewareHandler } from "hono";

import { db, sha256, type Db, type Tenant } from "./db";

/**
 * Who is calling, how often, and whether we have seen this exact request before.
 */

export type Vars = { tenant: Tenant; db: Db };
export type AppEnv = { Bindings: Env; Variables: Vars };

/**
 * Bearer API key → tenant. The key is hashed and looked up; the hash is the only thing the
 * database has ever held. A missing or unknown key is a 401 with a body that says which.
 */
export const apiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!key) {
    return c.json(
      { error: { code: "unauthorized", message: "Send the API key as a Bearer token." } },
      401,
    );
  }
  const d = db(c.env.DB);
  const tenant = await d.tenantByKeyHash(await sha256(key));
  if (!tenant) {
    return c.json({ error: { code: "unauthorized", message: "That API key is not known." } }, 401);
  }

  // Sixty a minute per key. The limiter is a Workers binding; nothing to run or scale.
  const { success } = await c.env.API_RATE.limit({ key: tenant.id });
  if (!success) {
    c.header("Retry-After", "60");
    return c.json(
      {
        error: {
          code: "rate_limited",
          message: "Sixty requests a minute per key. Try again shortly.",
        },
      },
      429,
    );
  }

  c.set("tenant", tenant);
  c.set("db", d);
  await next();
};

/**
 * Idempotency for writes. With an `Idempotency-Key` header, the first response to a request
 * is stored under the key and every repeat gets it back — the same status, the same body,
 * the same booking id — so a client that retried a timed-out POST does not book twice. The
 * same key with a different body is a 422: that is not a retry, it is a mistake.
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
  const seen = await d.idempotent(tenant.id, key);
  if (seen) {
    if (seen.request_hash !== requestHash) {
      return {
        status: 422,
        body: {
          error: {
            code: "idempotency_mismatch",
            message: "This Idempotency-Key was used with a different request.",
          },
        },
      };
    }
    return { status: seen.response_status, body: JSON.parse(seen.response_body), replayed: true };
  }
  const r = await handler();
  await d.rememberIdempotent(tenant.id, key, requestHash, r.status, JSON.stringify(r.body));
  return r;
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
