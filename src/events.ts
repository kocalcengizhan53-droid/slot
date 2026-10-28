import { sign } from "./auth";
import { id, type Db } from "./db";
import { iso } from "./lib/time";
import { log } from "./log";
import { SANDBOX_LIMITS } from "./sandbox";

/**
 * Outgoing webhooks: an event is written to every matching endpoint's queue, delivered at
 * once, and retried on a widening schedule by the cron if that fails. Every delivery is a
 * row the tenant can read, with the status and error of the last attempt — a webhook that
 * is not observable is a webhook nobody trusts.
 */

export type EventName =
  | "booking.held"
  | "booking.confirmed"
  | "booking.cancelled"
  | "hold.expired"
  | "payment.received"
  | "webhook.test";

/** Minutes until the next try, by attempt number: 1, 5, 30, 120, 720, then give up. */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
/** How long a receiver has to answer before the attempt counts as failed. */
export const ATTEMPT_TIMEOUT_MS = 8000;

export async function emit(
  d: Db,
  tenantId: string,
  event: EventName,
  data: unknown,
  deliverNow: (fn: Promise<unknown>) => void,
) {
  const hooks = (await d.webhooks(tenantId)).filter((w) => {
    if (!w.active) return false;
    const events = JSON.parse(w.events) as string[];
    return events.includes("*") || events.includes(event);
  });
  if (hooks.length === 0) return;
  // A sandbox is a public toy: cap how many requests it can make the server send.
  if (
    hooks[0].tenant_kind === "sandbox" &&
    ((await d.countDeliveries(tenantId)) ?? 0) + hooks.length > SANDBOX_LIMITS.deliveries
  ) {
    log("warn", "sandbox delivery quota reached", { tenant: tenantId, event });
    return;
  }
  const payload = JSON.stringify({ id: id("evt"), event, created_at: iso(new Date()), data });
  for (const hook of hooks) {
    const deliveryId = id("dlv");
    await d.enqueueDelivery({ id: deliveryId, webhook_id: hook.id, event, payload });
    deliverNow(
      attempt(d, {
        id: deliveryId,
        attempts: 0,
        url: hook.url,
        secret: hook.secret,
        payload,
        event,
      }).catch(() => undefined),
    );
  }
}

type Send = (url: string, init: RequestInit) => Promise<Response>;
let send: Send = (url, init) => fetch(url, init);

/**
 * Deliveries to this Worker's own host go through its SELF binding: a Worker fetching its own
 * workers.dev address is answered 404 by Cloudflare, which made the playground's test receiver
 * unreachable in production. Bindings are the same for every request an isolate serves, so this
 * is set once, from the request middleware and the cron, before anything is delivered.
 */
/** Where a delivery goes: through SELF for this Worker's own host, over the network for any other. */
export function selfRouting(env: { SELF?: Fetcher; SELF_HOST?: string }): Send {
  const { SELF: self, SELF_HOST: host } = env;
  return (url, init) =>
    self && host && new URL(url).host === host ? self.fetch(url, init) : fetch(url, init);
}

export function routeSelfDeliveries(env: { SELF?: Fetcher; SELF_HOST?: string }) {
  send = selfRouting(env);
}

/** One try at one delivery. Records the outcome and schedules the next try, or stops. */
export async function attempt(
  d: Db,
  delivery: {
    id: string;
    attempts: number;
    url: string;
    secret: string;
    payload: string;
    event: string;
  },
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  let status: number | null = null;
  let error: string | null = null;
  try {
    const signature = await sign(delivery.secret, timestamp, delivery.payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    const res = await send(delivery.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "slot-webhooks/1",
        "x-slot-event": delivery.event,
        "x-slot-delivery": delivery.id,
        "x-slot-signature": `t=${timestamp},v1=${signature}`,
      },
      body: delivery.payload,
      signal: controller.signal,
    });
    clearTimeout(timer);
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const delivered = status !== null && status >= 200 && status < 300;
  const nextMinutes = BACKOFF_MINUTES[delivery.attempts];
  const nextAttemptAt =
    delivered || nextMinutes === undefined
      ? null
      : iso(new Date(Date.now() + nextMinutes * 60_000));
  await d.recordAttempt(delivery.id, { status, error, delivered, nextAttemptAt });
  return delivered;
}

/** The cron's share: every delivery whose next try is due. */
export async function deliverDue(d: Db) {
  const due = await d.dueDeliveries();
  let delivered = 0;
  for (const row of due) {
    if (
      await attempt(d, {
        id: row.id,
        attempts: row.attempts,
        url: row.url,
        secret: row.secret,
        payload: row.payload,
        event: row.event,
      })
    )
      delivered += 1;
  }
  return { tried: due.length, delivered };
}
