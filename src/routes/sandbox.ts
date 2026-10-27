import { OpenAPIHono, createRoute } from "@hono/zod-openapi";

import type { AppEnv } from "../auth";
import { log } from "../log";
import { problem, problemContent } from "../problem";
import { MAX_LIVE_SANDBOXES, SANDBOX_HOURS, createSandbox } from "../sandbox";
import { SandboxSchema } from "../schemas";

export const sandbox = new OpenAPIHono<AppEnv>();

sandbox.openapi(
  createRoute({
    method: "post",
    path: "/sandbox",
    tags: ["Sandbox"],
    summary: "Create a sandbox and its API key",
    description: `No key needed. Returns a key for a tenant of your own, seeded with a small studio's calendar — three resources, their weekly hours and a few bookings — that is deleted ${SANDBOX_HOURS} hours later with everything in it. The key is shown once. Ten per minute per address.`,
    security: [],
    responses: {
      201: { description: "Created", content: { "application/json": { schema: SandboxSchema } } },
      429: { description: "Too many from this address", content: problemContent },
      503: { description: "Every sandbox is in use", content: problemContent },
    },
  }),
  async (c) => {
    const address = c.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await c.env.SANDBOX_RATE.limit({ key: address });
    if (!success) {
      c.header("Retry-After", "60");
      return problem(
        c,
        429,
        "rate_limited",
        "Ten sandboxes a minute per address. Try again shortly.",
      );
    }
    const d = c.get("db");
    if (((await d.liveSandboxes()) ?? 0) >= MAX_LIVE_SANDBOXES) {
      log("warn", "sandbox capacity reached", { request_id: c.get("requestId") });
      c.header("Retry-After", "3600");
      return problem(
        c,
        503,
        "sandbox_capacity",
        "Every sandbox is in use. One frees up within the hour.",
      );
    }
    const created = await createSandbox(d);
    log("info", "sandbox created", { request_id: c.get("requestId"), tenant: created.tenant_id });
    return c.json(created, 201);
  },
);
