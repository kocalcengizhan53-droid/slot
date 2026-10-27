import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { apiKey, type AppEnv } from "./auth";
import { db } from "./db";
import { deliverDue, emit, routeSelfDeliveries } from "./events";
import { flush, flushDue, operationMatcher, purgeLatency, record, summary } from "./latency";
import { log } from "./log";
import { notFoundPage as portalNotFound } from "./portal/pages";
import { portalRoutes } from "./portal/routes";
import type { OpenApiDoc } from "./portal/reference";
import { problem } from "./problem";
import { bookings } from "./routes/bookings";
import { payments } from "./routes/payments";
import { resources } from "./routes/resources";
import { sandbox } from "./routes/sandbox";
import { webhooks } from "./routes/webhooks";

/**
 * Slot — a reservations API on Cloudflare Workers and D1.
 *
 * Everything under /v1 wants a Bearer API key and is rate-limited per key, except two doors:
 * POST /v1/sandbox, which hands out keys, and the payment provider's webhook, which is signed
 * instead. The OpenAPI document is generated from the routes' own schemas, so the reference
 * cannot drift from the validation; the developer portal at the root renders it.
 */
const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        pointer: `/${issue.path.map(String).join("/")}`,
        detail: issue.message,
      }));
      return problem(
        c,
        422,
        "validation",
        errors.map((e) => `${e.pointer === "/" ? "body" : e.pointer}: ${e.detail}`).join("; "),
        errors,
      );
    }
  },
});

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Provider-Signature",
      "X-D1-Bookmark",
    ],
    exposeHeaders: [
      "Idempotent-Replayed",
      "Retry-After",
      "Server-Timing",
      "X-Request-Id",
      "X-D1-Bookmark",
    ],
  }),
);

let operationOf: ((method: string, path: string) => string | null) | null = null;

/**
 * Every request gets an id, a Server-Timing header and one JSON log line. API requests that
 * match an operation in the OpenAPI document are also counted into the latency histogram the
 * status page reads; the write happens after the response, at most every ten seconds.
 */
app.use("*", async (c, next) => {
  routeSelfDeliveries(c.env);
  const t0 = performance.now();
  const requestId = `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  c.set("requestId", requestId);
  await next();
  const ms = performance.now() - t0;
  c.res.headers.set("Server-Timing", `app;dur=${ms.toFixed(1)}`);
  c.res.headers.set("X-Request-Id", requestId);
  operationOf ??= operationMatcher(
    Object.entries(app.getOpenAPI31Document(DOC).paths ?? {}).flatMap(([path, ops]) =>
      Object.keys(ops ?? {}).map((method) => `${method.toUpperCase()} ${path}`),
    ),
  );
  const operation = c.req.path.startsWith("/v1/") ? operationOf(c.req.method, c.req.path) : null;
  log(c.res.status >= 500 ? "error" : "info", "request", {
    request_id: requestId,
    method: c.req.method,
    path: c.req.path,
    operation,
    status: c.res.status,
    dur_ms: Math.round(ms * 10) / 10,
    tenant: c.get("tenant")?.id,
    colo: (c.req.raw.cf as { colo?: string } | undefined)?.colo,
  });
  if (operation && c.res.status < 500) {
    record(operation, ms);
    if (flushDue())
      c.executionCtx.waitUntil(
        flush(c.env.DB).catch((e) => log("error", "latency flush failed", { error: String(e) })),
      );
  }
});

app.get("/health", (c) => c.json({ ok: true, now: new Date().toISOString() }));

/** Server time per operation over the last day, from real requests. Public; cached a minute per colo. */
app.get("/status.json", async (c) => {
  const cache = caches.default;
  const key = new Request(new URL("/status.json", c.req.url).toString());
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, hit);
  const body = {
    ...(await summary(c.env.DB)),
    colo: (c.req.raw.cf as { colo?: string } | undefined)?.colo ?? null,
    generated_at: new Date().toISOString(),
  };
  const res = c.json(body, 200, { "cache-control": "public, max-age=60" });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return res;
});

// Where the portal points its webhooks: a sink that answers 200 so deliveries succeed.
app.post("/demo/sink", async (c) => {
  await c.req.text();
  return c.json({ ok: true });
});

app.route(
  "/",
  portalRoutes(() => app.getOpenAPI31Document(DOC) as OpenApiDoc),
);

/**
 * A D1 session per request. Reads go to a nearby replica that has seen everything this
 * client has written — the client proves what it has seen with the bookmark from its last
 * response — and writes go to the primary.
 */
app.use("/v1/*", async (c, next) => {
  const sent = c.req.header("x-d1-bookmark");
  const session = c.env.DB.withSession(
    sent && /^[0-9a-f-]{8,200}$/i.test(sent) ? sent : "first-unconstrained",
  );
  c.set("db", db(session));
  await next();
  const bookmark = session.getBookmark();
  if (bookmark) c.res.headers.set("X-D1-Bookmark", bookmark);
});
app.use("/v1/*", (c, next) => {
  const open =
    (c.req.method === "POST" && c.req.path === "/v1/sandbox") ||
    c.req.path === "/v1/payments/webhook";
  return open ? next() : apiKey(c, next);
});
app.route("/v1", sandbox);
app.route("/v1", resources);
app.route("/v1", bookings);
app.route("/v1", webhooks);
app.route("/v1", payments);

const DOC = {
  openapi: "3.1.0",
  info: {
    title: "Slot",
    version: "1.1.0",
    description:
      "A reservations API: resources with weekly hours in their own time zone, slots in UTC, holds that expire, bookings that cannot double-book, signed webhooks with retries, an idempotent payment hook. Errors are RFC 9457 problem details; lists are cursor-paginated.",
  },
  tags: [
    { name: "Sandbox", description: "A key and a tenant of your own, for a day" },
    {
      name: "Resources",
      description: "Things that can be booked, their hours and their free slots",
    },
    { name: "Bookings", description: "Book, hold, confirm, cancel" },
    { name: "Webhooks", description: "Signed event deliveries with retries" },
    { name: "Payments", description: "The payment provider's side" },
  ],
  security: [{ bearer: [] }],
};

app.doc31("/openapi.json", DOC);
app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
  type: "http",
  scheme: "bearer",
  description: "The tenant's API key. Get a sandbox key from POST /v1/sandbox.",
});

app.notFound((c) =>
  c.req.path.startsWith("/v1/") || c.req.header("accept")?.includes("json")
    ? problem(
        c,
        404,
        "not_found",
        "No such route. The API is under /v1; the reference is at /docs/reference.",
      )
    : c.html(portalNotFound(), 404),
);
app.onError((err, c) => {
  log("error", "unhandled", {
    request_id: c.get("requestId"),
    path: c.req.path,
    error: err.message,
    stack: err.stack,
  });
  return problem(
    c,
    500,
    "internal",
    "Something went wrong on our side. Quote the request id if you report it.",
  );
});

export default {
  fetch: app.fetch,

  /**
   * Every five minutes: expire holds nobody confirmed, retry deliveries that are due, delete
   * sandboxes past their day, forget idempotency keys older than a day, and trim the latency
   * history to a week.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    routeSelfDeliveries(env);
    const d = db(env.DB);
    for (const hold of await d.expiredHolds()) {
      await d.setStatus(hold.id, "cancelled");
      const { tenant_id, ...rest } = hold;
      await emit(d, tenant_id, "hold.expired", { ...rest, status: "cancelled" }, (p) =>
        ctx.waitUntil(p),
      );
    }
    const deliveries = await deliverDue(d);
    const expired = await d.expiredSandboxes();
    for (const tenantId of expired) await d.purgeTenant(tenantId);
    const keys = await d.purgeIdempotency();
    await purgeLatency(env.DB);
    log("info", "cron", {
      deliveries_tried: deliveries.tried,
      deliveries_delivered: deliveries.delivered,
      sandboxes_purged: expired.length,
      idempotency_keys_purged: keys.meta.changes ?? 0,
    });
  },
} satisfies ExportedHandler<Env>;

export { app };
