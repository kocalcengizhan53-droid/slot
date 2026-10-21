import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";

import { apiKey, type AppEnv } from "./auth";
import { db } from "./db";
import { demoPage } from "./demo";
import { deliverDue, emit } from "./events";
import { bookings } from "./routes/bookings";
import { payments } from "./routes/payments";
import { resources } from "./routes/resources";
import { webhooks } from "./routes/webhooks";

/**
 * Slot — a reservations API on Cloudflare Workers and D1.
 *
 * Everything under /v1 wants a Bearer API key and is rate-limited per key. The payment
 * provider's webhook is signed instead. The OpenAPI document is generated from the routes'
 * own schemas, so the docs cannot drift from the validation; /docs renders it. The root is a
 * small playground that drives the same API a client would.
 */
const app = new OpenAPIHono<AppEnv>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      return c.json(
        {
          error: {
            code: "validation",
            message: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "invalid"}`,
          },
        },
        422,
      );
    }
  },
});

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "X-Provider-Signature"],
    exposeHeaders: ["Idempotent-Replayed", "Retry-After"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, now: new Date().toISOString() }));

app.get("/", (c) => c.html(demoPage(new URL(c.req.url).origin, c.env.DEMO_API_KEY)));

// Where the playground points its webhook: a sink that answers 200 so deliveries succeed.
app.post("/demo/sink", async (c) => {
  await c.req.text();
  return c.json({ ok: true });
});

app.use("/v1/*", (c, next) => (c.req.path === "/v1/payments/webhook" ? next() : apiKey(c, next)));
app.route("/v1", resources);
app.route("/v1", bookings);
app.route("/v1", webhooks);
app.route("/v1", payments);

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Slot",
    version: "1.0.0",
    description:
      "A reservations API: resources with weekly hours in their own time zone, slots in UTC, holds that expire, bookings that cannot double-book, signed webhooks with retries, an idempotent payment hook.",
  },
  security: [{ bearer: [] }],
});
app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
  type: "http",
  scheme: "bearer",
  description: "The tenant's API key",
});
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "No such route. The API is under /v1; the docs are at /docs.",
      },
    },
    404,
  ),
);
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
});

export default {
  fetch: app.fetch,

  /** Every five minutes: expire holds that nobody confirmed, and retry deliveries that are due. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const d = db(env.DB);
    for (const hold of await d.expiredHolds()) {
      await d.setStatus(hold.id, "cancelled");
      const { tenant_id, ...rest } = hold;
      await emit(d, tenant_id, "hold.expired", { ...rest, status: "cancelled" }, (p) =>
        ctx.waitUntil(p),
      );
    }
    const result = await deliverDue(d);
    console.log(`cron: ${result.tried} deliveries tried, ${result.delivered} delivered`);
  },
} satisfies ExportedHandler<Env>;

export { app };
