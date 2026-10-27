import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  BOUNDS,
  bucketOf,
  flush,
  operationMatcher,
  percentile,
  periodOf,
  record,
  summary,
} from "./latency";

describe("histogram", () => {
  it("puts a duration in the first bucket whose bound holds it", () => {
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(2)).toBe(0);
    expect(bucketOf(2.1)).toBe(1);
    expect(bucketOf(100)).toBe(BOUNDS.indexOf(100));
    expect(bucketOf(99_999)).toBe(BOUNDS.length);
  });

  it("reads percentiles back within the bucket they fall in", () => {
    const counts = new Array(BOUNDS.length + 1).fill(0);
    counts[bucketOf(8)] = 90; // 5–10 ms
    counts[bucketOf(120)] = 10; // 100–150 ms
    expect(percentile(counts, 0.5)).toBeGreaterThan(5);
    expect(percentile(counts, 0.5)).toBeLessThanOrEqual(10);
    expect(percentile(counts, 0.95)).toBeGreaterThan(100);
    expect(percentile(counts, 0.95)).toBeLessThanOrEqual(150);
    expect(percentile(new Array(BOUNDS.length + 1).fill(0), 0.5)).toBeNull();
  });

  it("groups time into five-minute periods", () => {
    expect(periodOf(new Date("2026-10-27T10:04:59.900Z"))).toBe("2026-10-27T10:00:00Z");
    expect(periodOf(new Date("2026-10-27T10:05:00Z"))).toBe("2026-10-27T10:05:00Z");
  });
});

describe("operations", () => {
  const match = operationMatcher([
    "GET /v1/webhooks",
    "GET /v1/webhooks/deliveries",
    "DELETE /v1/webhooks/{id}",
    "GET /v1/resources/{id}/availability",
  ]);

  it("maps a concrete path to its operation, preferring the literal one", () => {
    expect(match("GET", "/v1/webhooks/deliveries")).toBe("GET /v1/webhooks/deliveries");
    expect(match("DELETE", "/v1/webhooks/whk_1")).toBe("DELETE /v1/webhooks/{id}");
    expect(match("GET", "/v1/resources/res_room_a/availability")).toBe(
      "GET /v1/resources/{id}/availability",
    );
  });

  it("does not invent an operation for a path that has none", () => {
    expect(match("GET", "/v1/resources/res_a/nope")).toBeNull();
    expect(match("POST", "/v1/webhooks/deliveries")).toBeNull();
  });
});

it("writes what it recorded and summarises the last day from it", async () => {
  const now = new Date();
  for (const ms of [8, 9, 12, 30, 140]) record("GET /v1/test", ms, now);
  record("POST /v1/test", 60, now);
  await flush(env.DB);
  // A second flush of the same period adds to the row instead of replacing it.
  record("GET /v1/test", 9, now);
  await flush(env.DB);

  const s = await summary(env.DB, now);
  const get = s.operations.find((o) => o.operation === "GET /v1/test");
  expect(get?.count).toBe(6);
  expect(get?.p50).toBeGreaterThanOrEqual(5);
  expect(get?.p50).toBeLessThanOrEqual(15);
  expect(get?.p99).toBeGreaterThan(100);
  expect(s.overall.count).toBe(7);
  expect(s.hourly.at(-1)?.count).toBe(7);
});
