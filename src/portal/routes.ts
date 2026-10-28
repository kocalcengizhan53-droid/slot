import { Hono } from "hono";

import type { AppEnv } from "../auth";
import { page } from "./html";
import {
  errorsBody,
  guidesBody,
  homeBody,
  homeDescription,
  playgroundBody,
  statusBody,
} from "./pages";
import { referenceBody, type OpenApiDoc } from "./reference";

/**
 * The developer portal: server-rendered pages with no per-visitor content — the visitor's
 * sandbox key lives in their browser — so every page can be cached and rendered once per
 * isolate. The reference is built from the live OpenAPI document.
 */
export function portalRoutes(openapi: () => OpenApiDoc) {
  const portal = new Hono<AppEnv>();
  const rendered = new Map<string, string>();
  const once = (key: string, render: () => string) => {
    let html = rendered.get(key);
    if (!html) {
      html = render();
      rendered.set(key, html);
    }
    return html;
  };
  const headers = { "cache-control": "public, max-age=300" };

  portal.get("/", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      once(`home ${origin}`, () =>
        page({
          title: "Quickstart",
          description: homeDescription,
          path: "/",
          origin,
          body: homeBody(origin),
          scripts: ["/stage.js", "/zones.js", "/probe.js", "/retry.js"],
        }),
      ),
      200,
      headers,
    );
  });

  portal.get("/docs", (c) => c.redirect("/docs/reference", 301));

  portal.get("/docs/reference", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      once(`reference ${origin}`, () =>
        page({
          title: "API reference",
          description:
            "Every Slot endpoint with its parameters, body, responses, samples in curl, JavaScript and Python, and live server time.",
          path: "/docs/reference",
          origin,
          body: referenceBody(openapi(), origin),
        }),
      ),
      200,
      headers,
    );
  });

  portal.get("/docs/guides", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      once(`guides ${origin}`, () =>
        page({
          title: "Guides",
          description:
            "Retrying safely with idempotency keys, verifying signed webhooks, time zones, cursor pagination, limits and read-your-writes consistency.",
          path: "/docs/guides",
          origin,
          body: guidesBody(origin),
          scripts: ["/verify.js"],
        }),
      ),
      200,
      headers,
    );
  });

  portal.get("/docs/errors", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      once(`errors ${origin}`, () =>
        page({
          title: "Errors",
          description:
            "Every Slot error code: what it means and what to do. RFC 9457 problem details.",
          path: "/docs/errors",
          origin,
          body: errorsBody(origin),
        }),
      ),
      200,
      headers,
    );
  });

  portal.get("/status", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      once(`status ${origin}`, () =>
        page({
          title: "Status",
          description:
            "Slot's server time per endpoint over the last day, measured on real requests.",
          path: "/status",
          origin,
          body: statusBody(),
          scripts: ["/status.js"],
        }),
      ),
      200,
      headers,
    );
  });

  portal.get("/playground", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.html(
      once(`playground ${origin}`, () =>
        page({
          title: "Playground",
          description:
            "Book, hold, pay and receive webhooks on a week calendar backed by your own Slot sandbox.",
          path: "/playground",
          origin,
          body: playgroundBody(),
          scripts: ["/playground.js"],
        }),
      ),
      200,
      headers,
    );
  });

  return portal;
}
