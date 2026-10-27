import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { sign, verifySignature } from "../src/auth";
import { sha256 } from "../src/db";
import worker from "../src/index";

/**
 * The API, driven as a client would, inside workerd with a real D1 — the migrations applied
 * before this file runs. Each describe seeds what it needs through the API itself where it
 * can, and through SQL only for what the API deliberately cannot do (like making a hold old).
 */

const KEY = "test_sk_abc123";
const ORIGIN = "https://slot.test";
const headers = (extra: Record<string, string> = {}, key = KEY) => ({
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
  ...extra,
});
const call = (path: string, init: RequestInit = {}, key = KEY) =>
  SELF.fetch(`${ORIGIN}${path}`, { headers: headers({}, key), ...init });
const post = (path: string, body: unknown, extra: Record<string, string> = {}, key = KEY) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: headers(extra, key),
    body: JSON.stringify(body),
  });

type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: { pointer: string; detail: string }[];
};
type List<T> = { data: T[]; next_cursor: string | null };

/** Reads a problem response and checks the parts every one of them must have. */
async function problemOf(r: Response): Promise<Problem> {
  expect(r.headers.get("content-type")).toContain("application/problem+json");
  const p = (await r.json()) as Problem;
  expect(p.status).toBe(r.status);
  expect(p.request_id).toMatch(/^req_[0-9a-f]{16}$/);
  expect(p.request_id).toBe(r.headers.get("x-request-id"));
  return p;
}

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, name, api_key_hash, payment_secret, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ten_test", "Test Tenant", await sha256(KEY), "whsec_test", "2026-10-01T00:00:00Z")
    .run();
});

async function makeResource(
  opts: Partial<{ name: string; timezone: string; slot_minutes: number; capacity: number }> = {},
  key = KEY,
) {
  const r = await post(
    "/v1/resources",
    { name: "Room", timezone: "Europe/Istanbul", slot_minutes: 60, capacity: 1, ...opts },
    {},
    key,
  );
  expect(r.status).toBe(201);
  const resource = (await r.json()) as { id: string };
  // Open every weekday 09:00–18:00 local.
  const rules = [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start_minute: 540,
    end_minute: 1080,
  }));
  expect(
    (
      await call(
        `/v1/resources/${resource.id}/rules`,
        { method: "PUT", body: JSON.stringify(rules) },
        key,
      )
    ).status,
  ).toBe(200);
  return resource.id;
}

// A Thursday in Istanbul: 09:00 local is 06:00Z.
const THU = "2026-10-22";
const at = (h: number) => `${THU}T${String(h - 3).padStart(2, "0")}:00:00Z`;

describe("auth and errors", () => {
  it("wants a bearer key and knows a wrong one", async () => {
    const none = await SELF.fetch(`${ORIGIN}/v1/resources`);
    expect(none.status).toBe(401);
    expect((await problemOf(none)).code).toBe("unauthorized");
    const wrong = await SELF.fetch(`${ORIGIN}/v1/resources`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
    expect((await call("/v1/resources")).status).toBe(200);
  });

  it("answers errors as RFC 9457 problem details that name the field", async () => {
    const missing = await post("/v1/bookings", {
      resource_id: "res_nope",
      starts_at: at(9),
      ends_at: at(10),
      customer_name: "X",
    });
    expect(missing.status).toBe(404);
    const p = await problemOf(missing);
    expect(p).toMatchObject({ code: "not_found", title: "Not found", instance: "/v1/bookings" });
    expect(p.type).toBe(`${ORIGIN}/docs/errors#not_found`);

    const invalid = await post("/v1/bookings", { resource_id: "res_x" });
    expect(invalid.status).toBe(422);
    const v = await problemOf(invalid);
    expect(v.code).toBe("validation");
    expect(v.errors?.map((e) => e.pointer)).toEqual(
      expect.arrayContaining(["/starts_at", "/ends_at", "/customer_name"]),
    );

    const route = await call("/v1/nothing-here");
    expect(route.status).toBe(404);
    expect((await problemOf(route)).code).toBe("not_found");
  });

  it("stamps every response with a request id and the server's own time", async () => {
    const r = await call("/v1/resources");
    expect(r.headers.get("x-request-id")).toMatch(/^req_[0-9a-f]{16}$/);
    expect(r.headers.get("server-timing")).toMatch(/^app;dur=\d+(\.\d)?$/);
  });

  it("serves the OpenAPI document without a key, sandbox and payment hook marked open", async () => {
    const doc = (await (await SELF.fetch(`${ORIGIN}/openapi.json`)).json()) as {
      openapi: string;
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/sandbox", "/v1/bookings", "/v1/resources/{id}/availability"]),
    );
    expect(doc.paths["/v1/sandbox"].post.security).toEqual([]);
    expect(doc.paths["/v1/payments/webhook"].post.security).toEqual([]);
  });
});

describe("resources and availability", () => {
  it("rejects a time zone Intl does not know", async () => {
    const r = await post("/v1/resources", { name: "X", timezone: "Mars/Olympus" });
    expect(r.status).toBe(422);
    expect((await problemOf(r)).code).toBe("invalid_timezone");
  });

  it("offers the slots the rules say, in UTC with a local reading", async () => {
    const id = await makeResource();
    const r = await call(`/v1/resources/${id}/availability?from=${THU}`);
    expect(r.status).toBe(200);
    const a = (await r.json()) as {
      days: { date: string; slots: { starts_at: string; local: string; available: number }[] }[];
    };
    expect(a.days[0].slots).toHaveLength(9);
    expect(a.days[0].slots[0]).toMatchObject({
      starts_at: at(9),
      local: `${THU}T09:00`,
      available: 1,
    });
  });

  it("caps a range at 31 days and validates dates", async () => {
    const id = await makeResource();
    const long = await call(`/v1/resources/${id}/availability?from=2026-10-01&to=2026-12-01`);
    expect((await problemOf(long)).code).toBe("range_too_long");
    expect((await call(`/v1/resources/${id}/availability?from=2026-13-01`)).status).toBe(422);
  });
});

describe("bookings", () => {
  it("books a slot, then refuses the same slot, then shows it taken", async () => {
    const id = await makeResource();
    const first = await post("/v1/bookings", {
      resource_id: id,
      starts_at: at(10),
      ends_at: at(11),
      customer_name: "A",
    });
    expect(first.status).toBe(201);
    expect(((await first.json()) as { status: string }).status).toBe("confirmed");

    const second = await post("/v1/bookings", {
      resource_id: id,
      starts_at: at(10),
      ends_at: at(11),
      customer_name: "B",
    });
    expect(second.status).toBe(409);
    expect((await problemOf(second)).code).toBe("full");

    const a = (await (await call(`/v1/resources/${id}/availability?from=${THU}`)).json()) as {
      days: { slots: { local: string; available: number }[] }[];
    };
    expect(a.days[0].slots.find((s) => s.local.endsWith("10:00"))?.available).toBe(0);
  });

  it("refuses a booking off the grid or outside the hours, with the reason", async () => {
    const id = await makeResource();
    const off = await post("/v1/bookings", {
      resource_id: id,
      starts_at: `${THU}T07:15:00Z`,
      ends_at: `${THU}T08:15:00Z`,
      customer_name: "A",
    });
    expect((await problemOf(off)).code).toBe("off_grid");
    const out = await post("/v1/bookings", {
      resource_id: id,
      starts_at: `${THU}T03:00:00Z`,
      ends_at: `${THU}T04:00:00Z`,
      customer_name: "A",
    });
    expect((await problemOf(out)).code).toBe("outside_hours");
  });

  // End to end only: the runner serialises these requests. The race is proven in races.test.ts.
  it("gives a three-place slot to three of five requests sent together", async () => {
    const id = await makeResource({ capacity: 3 });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        post("/v1/bookings", {
          resource_id: id,
          starts_at: at(14),
          ends_at: at(15),
          customer_name: `P${i}`,
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it("holds, confirms, and treats an expired hold as gone", async () => {
    const id = await makeResource();
    const held = await post("/v1/bookings", {
      resource_id: id,
      starts_at: at(12),
      ends_at: at(13),
      customer_name: "H",
      hold: true,
      hold_minutes: 5,
    });
    expect(held.status).toBe(201);
    const booking = (await held.json()) as { id: string; status: string; hold_expires_at: string };
    expect(booking.status).toBe("held");
    expect(booking.hold_expires_at).toBeTruthy();

    // While held, the slot is taken.
    const blocked = { resource_id: id, starts_at: at(12), ends_at: at(13), customer_name: "X" };
    expect((await post("/v1/bookings", blocked)).status).toBe(409);

    // Age the hold past its expiry: the one thing the API will not let a client do.
    await env.DB.prepare(
      "UPDATE bookings SET hold_expires_at = '2020-01-01T00:00:00Z' WHERE id = ?",
    )
      .bind(booking.id)
      .run();
    const read = (await (await call(`/v1/bookings/${booking.id}`)).json()) as { status: string };
    expect(read.status).toBe("cancelled");
    const confirm = await post(`/v1/bookings/${booking.id}/confirm`, {});
    expect((await problemOf(confirm)).code).toBe("not_held");
    // And the slot is free again.
    expect((await post("/v1/bookings", blocked)).status).toBe(201);
  });

  it("confirms a live hold and cancels a booking", async () => {
    const id = await makeResource();
    const held = (await (
      await post("/v1/bookings", {
        resource_id: id,
        starts_at: at(15),
        ends_at: at(16),
        customer_name: "H",
        hold: true,
      })
    ).json()) as { id: string };
    const confirmed = (await (await post(`/v1/bookings/${held.id}/confirm`, {})).json()) as {
      status: string;
      hold_expires_at: string | null;
    };
    expect(confirmed).toMatchObject({ status: "confirmed", hold_expires_at: null });
    const cancelled = (await (await post(`/v1/bookings/${held.id}/cancel`, {})).json()) as {
      status: string;
    };
    expect(cancelled.status).toBe("cancelled");
    const stored = (await (await call(`/v1/bookings/${held.id}`)).json()) as { status: string };
    expect(stored.status).toBe("cancelled");
  });

  it("pages through bookings newest first, without repeats or gaps", async () => {
    const id = await makeResource();
    for (const h of [9, 10, 11, 12, 13])
      expect(
        (
          await post("/v1/bookings", {
            resource_id: id,
            starts_at: at(h),
            ends_at: at(h + 1),
            customer_name: "L",
          })
        ).status,
      ).toBe(201);
    const starts: string[] = [];
    const ids = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await call(
        `/v1/bookings?resource_id=${id}&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      const p = (await r.json()) as List<{ id: string; starts_at: string }>;
      for (const b of p.data) {
        starts.push(b.starts_at);
        ids.add(b.id);
      }
      cursor = p.next_cursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(ids.size).toBe(5);
    expect(starts).toEqual([...starts].sort().reverse());
    expect((await problemOf(await call("/v1/bookings?cursor=garbage"))).code).toBe(
      "invalid_cursor",
    );
  });
});

describe("idempotency", () => {
  it("replays the first response under a key, and refuses the key with a different body", async () => {
    const id = await makeResource();
    const body = { resource_id: id, starts_at: at(16), ends_at: at(17), customer_name: "I" };
    const a = await post("/v1/bookings", body, { "idempotency-key": "k-1" });
    const b = await post("/v1/bookings", body, { "idempotency-key": "k-1" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(((await a.json()) as { id: string }).id).toBe(((await b.json()) as { id: string }).id);
    const c = await post(
      "/v1/bookings",
      { ...body, customer_name: "J" },
      { "idempotency-key": "k-1" },
    );
    expect((await problemOf(c)).code).toBe("idempotency_mismatch");
  });

  // End to end only: the runner serialises these requests. The race is proven in races.test.ts.
  it("makes one booking from five retries sent together under one key", async () => {
    // Room for five, so only the key can stop five bookings from being made.
    const id = await makeResource({ capacity: 5 });
    const body = { resource_id: id, starts_at: at(9), ends_at: at(10), customer_name: "R" };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post("/v1/bookings", body, { "idempotency-key": "race-1" })),
    );
    const made = await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE resource_id = ?")
      .bind(id)
      .first<number>("n");
    expect(made).toBe(1);
    for (const r of results) {
      expect([201, 409]).toContain(r.status);
      if (r.status === 409) expect((await problemOf(r)).code).toBe("idempotency_in_progress");
    }
  });

  it("forgets a key after a day: the cron deletes it, and an old key is free to reuse", async () => {
    const id = await makeResource();
    await env.DB.prepare(
      "INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body, created_at) VALUES ('ten_test', 'old-key', 'x', 201, '{}', '2020-01-01T00:00:00Z')",
    ).run();
    const reuse = await post(
      "/v1/bookings",
      { resource_id: id, starts_at: at(11), ends_at: at(12), customer_name: "O" },
      { "idempotency-key": "old-key" },
    );
    expect(reuse.status).toBe(201);
    expect(reuse.headers.get("idempotent-replayed")).toBeNull();

    await env.DB.prepare(
      "INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_status, response_body, created_at) VALUES ('ten_test', 'stale', 'x', 201, '{}', '2020-01-01T00:00:00Z')",
    ).run();
    await runCron();
    const left = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM idempotency_keys WHERE key = 'stale'",
    ).first<number>("n");
    expect(left).toBe(0);
  });
});

async function runCron() {
  const ctx = createExecutionContext();
  await worker.scheduled(
    {
      scheduledTime: Date.now(),
      cron: "*/5 * * * *",
      noRetry() {},
    } as unknown as ScheduledController,
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

const settle = () => new Promise((r) => setTimeout(r, 300));

describe("webhooks", () => {
  it("signs what it sends, and the signature verifies", async () => {
    const sig = await sign("s", "1700000000", '{"a":1}');
    expect(await verifySignature("s", `t=1700000000,v1=${sig}`, '{"a":1}', 1700000100)).toBe(true);
    expect(await verifySignature("s", `t=1700000000,v1=${sig}`, '{"a":2}', 1700000100)).toBe(false);
    expect(await verifySignature("s", `t=1700000000,v1=${sig}`, '{"a":1}', 1700009999)).toBe(false);
  });

  it("refuses a URL that points inside: IPs, metadata, private names, plain http", async () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://localhost/",
      "https://db.internal/",
      "http://receiver.example.com/ok",
    ]) {
      const r = await post("/v1/webhooks", { url, events: ["*"] });
      expect(r.status, url).toBe(422);
      const p = await problemOf(r);
      expect(p.errors?.[0].pointer).toBe("/url");
    }
  });

  it("delivers to a receiver that answers, and schedules a retry for one that does not", async () => {
    const ok = await post("/v1/webhooks", {
      url: "https://receiver.example.com/ok",
      events: ["booking.confirmed"],
    });
    const down = await post("/v1/webhooks", {
      url: "https://receiver.example.com/down",
      events: ["booking.confirmed"],
    });
    expect(ok.status).toBe(201);
    const hook = (await down.json()) as { id: string; secret: string };
    expect(hook.secret).toMatch(/^whsec_/);

    const id = await makeResource();
    await post("/v1/bookings", {
      resource_id: id,
      starts_at: at(9),
      ends_at: at(10),
      customer_name: "W",
    });
    // The attempts ran in the background; give them a moment, then read the record.
    await settle();
    const list = (await (await call("/v1/webhooks/deliveries?limit=100")).json()) as List<{
      event: string;
      webhook_id: string;
      attempts: number;
      delivered_at: string | null;
      next_attempt_at: string | null;
      last_status: number | null;
    }>;
    const failed = list.data.find((x) => x.webhook_id === hook.id);
    expect(failed).toMatchObject({ attempts: 1, delivered_at: null, last_status: 503 });
    expect(failed?.next_attempt_at).toBeTruthy();
    const delivered = list.data.find(
      (x) => x.webhook_id !== hook.id && x.event === "booking.confirmed",
    );
    expect(delivered).toMatchObject({ attempts: 1, last_status: 200, next_attempt_at: null });

    expect((await call(`/v1/webhooks/${hook.id}`, { method: "DELETE" })).status).toBe(204);
  });
});

describe("payments", () => {
  const signed = async (body: object, secret = "whsec_test") => {
    const raw = JSON.stringify(body);
    const t = String(Math.floor(Date.now() / 1000));
    const v1 = await sign(secret, t, raw);
    return SELF.fetch(`${ORIGIN}/v1/payments/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-provider-signature": `t=${t},v1=${v1}` },
      body: raw,
    });
  };

  it("confirms a hold on a signed success, once", async () => {
    const id = await makeResource();
    const held = (await (
      await post("/v1/bookings", {
        resource_id: id,
        starts_at: at(11),
        ends_at: at(12),
        customer_name: "P",
        hold: true,
      })
    ).json()) as { id: string };
    const event = {
      provider_ref: "pay_once",
      booking_id: held.id,
      amount_minor: 5000,
      currency: "GBP",
      status: "succeeded",
    };
    const first = (await (await signed(event)).json()) as {
      applied: boolean;
      booking_status: string;
    };
    expect(first).toEqual({ received: true, applied: true, booking_status: "confirmed" });
    const replay = (await (await signed(event)).json()) as { applied: boolean };
    expect(replay.applied).toBe(false);
    const detail = (await (await call(`/v1/bookings/${held.id}`)).json()) as {
      status: string;
      payments: unknown[];
    };
    expect(detail.status).toBe("confirmed");
    expect(detail.payments).toHaveLength(1);
  });

  it("refuses a bad signature", async () => {
    const id = await makeResource();
    const b = (await (
      await post("/v1/bookings", {
        resource_id: id,
        starts_at: at(13),
        ends_at: at(14),
        customer_name: "P",
        hold: true,
      })
    ).json()) as { id: string };
    const r = await signed(
      {
        provider_ref: "pay_bad",
        booking_id: b.id,
        amount_minor: 1,
        currency: "GBP",
        status: "succeeded",
      },
      "wrong",
    );
    expect((await problemOf(r)).code).toBe("bad_signature");
  });
});

type Sandbox = {
  api_key: string;
  payment_secret: string;
  tenant_id: string;
  expires_at: string;
  resources: { id: string; name: string; timezone: string }[];
};
const newSandbox = async () => {
  const r = await SELF.fetch(`${ORIGIN}/v1/sandbox`, { method: "POST" });
  expect(r.status).toBe(201);
  return (await r.json()) as Sandbox;
};

describe("sandboxes", () => {
  it("hands out a key to a seeded tenant of its own, for a day", async () => {
    const sb = await newSandbox();
    expect(sb.api_key).toMatch(/^sk_test_[0-9a-f]{32}$/);
    const hoursLeft = (Date.parse(sb.expires_at) - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);

    const resources = (await (await call("/v1/resources", {}, sb.api_key)).json()) as List<{
      name: string;
    }>;
    expect(resources.data.map((r) => r.name)).toEqual([
      "Room A — recording",
      "Room B — rehearsal",
      "Mixing class",
    ]);
    const seeded = (await (await call("/v1/bookings?limit=100", {}, sb.api_key)).json()) as List<{
      starts_at: string;
    }>;
    expect(seeded.data).toHaveLength(10);
    expect(seeded.data.every((b) => Date.parse(b.starts_at) > Date.now())).toBe(true);
  });

  it("sees nothing of anyone else's, and nobody sees its data", async () => {
    const sb = await newSandbox();
    const mine = await makeResource();
    const b = (await (
      await post("/v1/bookings", {
        resource_id: mine,
        starts_at: at(17),
        ends_at: at(18),
        customer_name: "S",
      })
    ).json()) as { id: string };
    expect((await call(`/v1/bookings/${b.id}`, {}, sb.api_key)).status).toBe(404);
    expect(
      (await call(`/v1/resources/${mine}/availability?from=${THU}`, {}, sb.api_key)).status,
    ).toBe(404);
    expect((await call(`/v1/resources/${sb.resources[0].id}`)).status).toBe(404);
  });

  it("holds three webhook endpoints at most", async () => {
    const sb = await newSandbox();
    for (let i = 0; i < 3; i++)
      expect(
        (
          await post(
            "/v1/webhooks",
            { url: `https://receiver.example.com/ok?${i}` },
            {},
            sb.api_key,
          )
        ).status,
      ).toBe(201);
    const fourth = await post(
      "/v1/webhooks",
      { url: "https://receiver.example.com/ok" },
      {},
      sb.api_key,
    );
    expect(fourth.status).toBe(403);
    expect((await problemOf(fourth)).code).toBe("quota_exceeded");
  });

  it("stops answering when the day is up, and the cron deletes everything it owned", async () => {
    const sb = await newSandbox();
    await env.DB.prepare("UPDATE tenants SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?")
      .bind(sb.tenant_id)
      .run();
    const r = await call("/v1/resources", {}, sb.api_key);
    expect(r.status).toBe(401);
    expect((await problemOf(r)).code).toBe("sandbox_expired");

    await runCron();
    const counts = await env.DB.batch<{ n: number }>(
      [
        "SELECT COUNT(*) AS n FROM tenants WHERE id = ?1",
        "SELECT COUNT(*) AS n FROM resources WHERE tenant_id = ?1",
        "SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ?1",
      ].map((sql) => env.DB.prepare(sql).bind(sb.tenant_id)),
    );
    expect(counts.map((c) => c.results[0].n)).toEqual([0, 0, 0]);
  });
});

describe("cron", () => {
  it("cancels expired holds and emits hold.expired", async () => {
    await post("/v1/webhooks", {
      url: "https://receiver.example.com/down",
      events: ["hold.expired"],
    });
    const id = await makeResource();
    const held = (await (
      await post("/v1/bookings", {
        resource_id: id,
        starts_at: at(17),
        ends_at: at(18),
        customer_name: "C",
        hold: true,
      })
    ).json()) as { id: string };
    await env.DB.prepare(
      "UPDATE bookings SET hold_expires_at = '2020-01-01T00:00:00Z' WHERE id = ?",
    )
      .bind(held.id)
      .run();

    await runCron();

    const row = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
      .bind(held.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("cancelled");
    const list = (await (await call("/v1/webhooks/deliveries?limit=100")).json()) as List<{
      event: string;
    }>;
    expect(list.data.some((d) => d.event === "hold.expired")).toBe(true);
  });
});

// Last, because it spends this address's sandbox allowance for the minute.
describe("rate limits", () => {
  it("lets an address create ten sandboxes a minute, then answers 429 with Retry-After", async () => {
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 12; i++) {
      last = await SELF.fetch(`${ORIGIN}/v1/sandbox`, {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.9" },
      });
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(last!.headers.get("retry-after")).toBe("60");
    expect((await problemOf(last!)).code).toBe("rate_limited");
  });
});
