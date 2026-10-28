import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

import { ATTEMPT_TIMEOUT_MS, BACKOFF_MINUTES } from "../src/events";
import { PROBLEM_CODES } from "../src/problem";
import { ERROR_DOCS } from "../src/portal/errors";
import { slug } from "../src/portal/reference";

/** The developer portal: every page answers, and nothing it links to lands nowhere. */

const ORIGIN = "https://slot.test";
const html = async (path: string) => {
  const r = await SELF.fetch(`${ORIGIN}${path}`);
  expect(r.status, path).toBe(200);
  expect(r.headers.get("content-type")).toContain("text/html");
  return r.text();
};

it("documents every problem code, so each problem's `type` link resolves", async () => {
  expect(Object.keys(ERROR_DOCS).sort()).toEqual([...PROBLEM_CODES].sort());
  const page = await html("/docs/errors");
  for (const code of PROBLEM_CODES) expect(page, code).toContain(`id="${code}"`);
});

it("renders every operation in the OpenAPI document in the reference", async () => {
  const doc = (await (await SELF.fetch(`${ORIGIN}/openapi.json`)).json()) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const page = await html("/docs/reference");
  const ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((m) => slug(m, path)),
  );
  expect(ops.length).toBeGreaterThan(15);
  for (const id of ops) expect(page, id).toContain(`id="${id}"`);
});

it("gives every page a title, a description and a share image", async () => {
  for (const path of [
    "/",
    "/docs/reference",
    "/docs/guides",
    "/docs/errors",
    "/status",
    "/playground",
  ]) {
    const page = await html(path);
    expect(page, path).toMatch(/<title>[^<]*Slot[^<]*<\/title>/);
    expect(page, path).toMatch(/<meta name="description" content="[^"]{40,}">/);
    expect(page, path).toContain(`<meta property="og:image" content="${ORIGIN}/og.png">`);
  }
});

it("moves the old docs address, and answers an unknown page with an HTML 404", async () => {
  const moved = await SELF.fetch(`${ORIGIN}/docs`, { redirect: "manual" });
  expect(moved.status).toBe(301);
  expect(moved.headers.get("location")).toBe("/docs/reference");
  const missing = await SELF.fetch(`${ORIGIN}/nothing-here`, { headers: { accept: "text/html" } });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain("<title>Not found · Slot</title>");
});

it("publishes the last day's server time without a key", async () => {
  const r = await SELF.fetch(`${ORIGIN}/status.json`);
  expect(r.status).toBe(200);
  const s = (await r.json()) as {
    window_hours: number;
    overall: { count: number };
    operations: unknown[];
  };
  expect(s.window_hours).toBe(24);
  expect(typeof s.overall.count).toBe("number");
  expect(Array.isArray(s.operations)).toBe(true);
});

it("draws the retry timeline from the schedule the cron uses", async () => {
  const page = await html("/");
  const attr = /data-backoff="([^"]+)"/.exec(page)?.[1];
  expect(JSON.parse(attr!.replace(/&quot;/g, '"'))).toEqual(BACKOFF_MINUTES);
  expect(page).toContain(`data-timeout="${ATTEMPT_TIMEOUT_MS / 1000}"`);
  expect(page).toContain(`${BACKOFF_MINUTES.length + 1} tries over 14 hours 36 minutes`);
  for (const script of ["/probe.js", "/retry.js"]) expect(page).toContain(`src="${script}"`);
});
