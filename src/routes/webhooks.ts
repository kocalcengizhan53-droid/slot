import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import type { AppEnv } from "../auth";
import { id, type Webhook } from "../db";
import { emit } from "../events";
import { DeliverySchema, ErrorBody, Id, NewWebhook, WebhookSchema } from "../schemas";

export const webhooks = new OpenAPIHono<AppEnv>();

const tags = ["Webhooks"];

const publicWebhook = (w: Webhook) => ({
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
        description: "Endpoints",
        content: { "application/json": { schema: z.array(WebhookSchema) } },
      },
    },
  }),
  async (c) => c.json((await c.get("db").webhooks(c.get("tenant").id)).map(publicWebhook), 200),
);

webhooks.openapi(
  createRoute({
    method: "post",
    path: "/webhooks",
    tags,
    summary: "Add a webhook endpoint",
    description:
      'The response carries the signing secret once. Every delivery is signed `X-Slot-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`.',
    request: { body: { content: { "application/json": { schema: NewWebhook } } } },
    responses: {
      201: {
        description: "Created, with the secret",
        content: { "application/json": { schema: WebhookSchema.extend({ secret: z.string() }) } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const d = c.get("db");
    const secret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
    const w = {
      id: id("whk"),
      tenant_id: c.get("tenant").id,
      url: body.url,
      secret,
      events: JSON.stringify(body.events),
    };
    await d.createWebhook(w);
    const saved = (await d.webhooks(w.tenant_id)).find((x) => x.id === w.id)!;
    return c.json({ ...publicWebhook(saved), secret }, 201);
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const gone = await c.get("db").deleteWebhook(c.get("tenant").id, c.req.valid("param").id);
    if (!gone) return c.json({ error: { code: "not_found", message: "No such webhook." } }, 404);
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const tenant = c.get("tenant");
    const hook = (await d.webhooks(tenant.id)).find((w) => w.id === c.req.valid("param").id);
    if (!hook) return c.json({ error: { code: "not_found", message: "No such webhook." } }, 404);
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
    summary: "Recent deliveries, with the last attempt's outcome",
    responses: {
      200: {
        description: "Most recent first, up to 50",
        content: { "application/json": { schema: z.array(DeliverySchema) } },
      },
    },
  }),
  async (c) => {
    const list = await c.get("db").deliveries(c.get("tenant").id);
    return c.json(
      list.map(({ payload: _p, ...rest }) => {
        void _p;
        return rest;
      }),
      200,
    );
  },
);
