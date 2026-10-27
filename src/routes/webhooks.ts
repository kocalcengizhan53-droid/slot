import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import type { AppEnv } from "../auth";
import { id, type Webhook } from "../db";
import { emit } from "../events";
import { PageQuery, decodeCursor, listOf, page } from "../page";
import { problem, problemContent } from "../problem";
import { SANDBOX_LIMITS } from "../sandbox";
import { DeliverySchema, Id, NewWebhook, WebhookSchema } from "../schemas";

export const webhooks = new OpenAPIHono<AppEnv>();

const tags = ["Webhooks"];

const publicWebhook = (w: Pick<Webhook, "id" | "url" | "events" | "active" | "created_at">) => ({
  id: w.id,
  url: w.url,
  events: JSON.parse(w.events) as string[],
  active: w.active === 1,
  created_at: w.created_at,
});

webhooks.openapi(
  createRoute({
    method: "get",
    path: "/webhooks",
    tags,
    summary: "List webhook endpoints",
    responses: {
      200: {
        description: "Every endpoint; a tenant has few, so this list is never paged",
        content: { "application/json": { schema: listOf(WebhookSchema, "WebhookList") } },
      },
    },
  }),
  async (c) =>
    c.json(
      {
        data: (await c.get("db").webhooks(c.get("tenant").id)).map(publicWebhook),
        next_cursor: null,
      },
      200,
    ),
);

webhooks.openapi(
  createRoute({
    method: "post",
    path: "/webhooks",
    tags,
    summary: "Add a webhook endpoint",
    description:
      'The response carries the signing secret once. Every delivery is signed `X-Slot-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`. The URL must be HTTPS to a public host name.',
    request: { body: { content: { "application/json": { schema: NewWebhook } } } },
    responses: {
      201: {
        description: "Created, with the secret",
        content: { "application/json": { schema: WebhookSchema.extend({ secret: z.string() }) } },
      },
      403: { description: "Sandbox quota reached", content: problemContent },
      422: { description: "The URL is not allowed", content: problemContent },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const d = c.get("db");
    const tenant = c.get("tenant");
    if (
      tenant.kind === "sandbox" &&
      (await d.webhooks(tenant.id)).length >= SANDBOX_LIMITS.webhooks
    )
      return problem(
        c,
        403,
        "quota_exceeded",
        `A sandbox holds up to ${SANDBOX_LIMITS.webhooks} webhook endpoints.`,
      );
    const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
    const created = await d.createWebhook({
      id: id("whk"),
      tenant_id: tenant.id,
      url: body.url,
      secret,
      events: JSON.stringify(body.events),
    });
    return c.json({ ...publicWebhook(created), secret }, 201);
  },
);

webhooks.openapi(
  createRoute({
    method: "delete",
    path: "/webhooks/{id}",
    tags,
    summary: "Remove a webhook endpoint",
    request: { params: z.object({ id: Id }) },
    responses: {
      204: { description: "Removed" },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const gone = await c.get("db").deleteWebhook(c.get("tenant").id, c.req.valid("param").id);
    if (!gone) return problem(c, 404, "not_found", "No such webhook.");
    return c.body(null, 204);
  },
);

webhooks.openapi(
  createRoute({
    method: "post",
    path: "/webhooks/{id}/test",
    tags,
    summary: "Send a test event to one endpoint",
    request: { params: z.object({ id: Id }) },
    responses: {
      202: {
        description: "Queued and attempted",
        content: { "application/json": { schema: z.object({ queued: z.boolean() }) } },
      },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const tenant = c.get("tenant");
    const hook = (await d.webhooks(tenant.id)).find((w) => w.id === c.req.valid("param").id);
    if (!hook) return problem(c, 404, "not_found", "No such webhook.");
    await emit(d, tenant.id, "webhook.test", { hello: "from Slot", webhook_id: hook.id }, (p) =>
      c.executionCtx.waitUntil(p),
    );
    return c.json({ queued: true }, 202);
  },
);

webhooks.openapi(
  createRoute({
    method: "get",
    path: "/webhooks/deliveries",
    tags,
    summary: "Deliveries, with the last attempt's outcome",
    description: "Newest first.",
    request: { query: PageQuery },
    responses: {
      200: {
        description: "A page of deliveries",
        content: { "application/json": { schema: listOf(DeliverySchema, "DeliveryList") } },
      },
      422: { description: "Invalid cursor", content: problemContent },
    },
  }),
  async (c) => {
    const { limit, cursor } = c.req.valid("query");
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after)
      return problem(c, 422, "invalid_cursor", "That cursor did not come from this list.");
    const rows = await c.get("db").deliveries(c.get("tenant").id, limit, after);
    const result = page(rows, limit, (d) => ({ sort: d.created_at, id: d.id }));
    return c.json(
      {
        data: result.data.map(({ payload: _p, ...rest }) => {
          void _p;
          return rest;
        }),
        next_cursor: result.next_cursor,
      },
      200,
    );
  },
);
