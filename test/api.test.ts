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
const headers = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${KEY}`,
  "content-type": "application/json",
  ...extra,
});
const call = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://slot.test${path}`, { headers: headers(), ...init });
const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  SELF.fetch(`https://slot.test${path}`, {
    method: "POST",
    headers: headers(extra),
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO tenants (id, name, api_key_hash, payment_secret, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("ten_test", "Test Tenant", await sha256(KEY), "whsec_test", "2026-10-01T00:00:00Z")
    .run();
});

async function makeResource(
  opts: Partial<{ name: string; timezone: string; slot_minutes: number; capacity: number }> = {},
) {
  const r = await post("/v1/resources", {
    name: "Room",
    timezone: "Europe/Istanbul",
    slot_minutes: 60,
    capacity: 1,
    ...opts,
  });
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
      await call(`/v1/resources/${resource.id}/rules`, {
        method: "PUT",
        body: JSON.stringify(rules),
      })
    ).status,
  ).toBe(200);
  return resource.id;
}

// A Thursday in Istanbul: 09:00 local is 06:00Z.
const THU = "2026-10-22";
const at = (h: number) => `${THU}T${String(h - 3).padStart(2, "0")}:00:00Z`;

describe("auth", () => {
  it("wants a bearer key and knows a wrong one", async () => {
    expect((await SELF.fetch("https://slot.test/v1/resources")).status).toBe(401);
    expect(
      (
        await SELF.fetch("https://slot.test/v1/resources", {
          headers: { authorization: "Bearer nope" },
        })
      ).status,
    ).toBe(401);
    expect((await call("/v1/resources")).status).toBe(200);
  });

  it("serves the docs and the OpenAPI document without a key", async () => {
    expect((await SELF.fetch("https://slot.test/docs")).status).toBe(200);
    const doc = (await (await SELF.fetch("https://slot.test/openapi.json")).json()) as {
      paths: Record<string, unknown>;
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/bookings",
        "/v1/resources/{id}/availability",
        "/v1/payments/webhook",
      ]),
    );
  });
});

describe("resources and availability", () => {
  it("rejects a time zone Intl does not know", async () => {
    const r = await post("/v1/resources", { name: "X", timezone: "Mars/Olympus" });
    expect(r.status).toBe(422);
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
    expect(
      (await call(`/v1/resources/${id}/availability?from=2026-10-01&to=2026-12-01`)).status,
    ).toBe(422);
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
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("full");

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
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe("off_grid");
    const out = await post("/v1/bookings", {
      resource_id: id,
      starts_at: `${THU}T03:00:00Z`,
      ends_at: `${THU}T04:00:00Z`,
      customer_name: "A",
    });
    expect(((await out.json()) as { error: { code: string } }).error.code).toBe("outside_hours");
  });

  it("gives the last place to exactly one of five simultaneous requests", async () => {
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
    const won = results.filter((r) => r.status === 201).length;
    expect(won).toBe(3);
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
    expect(
      (
        await post("/v1/bookings", {
          resource_id: id,
          starts_at: at(12),
          ends_at: at(13),
          customer_name: "X",
        })
      ).status,
    ).toBe(409);

    // Age the hold past its expiry: the one thing the API will not let a client do.
    await env.DB.prepare(
      "UPDATE bookings SET hold_expires_at = '2020-01-01T00:00:00Z' WHERE id = ?",
    )
      .bind(booking.id)
      .run();
    const read = (await (await call(`/v1/bookings/${booking.id}`)).json()) as { status: string };
    expect(read.status).toBe("cancelled");
    expect((await post(`/v1/bookings/${booking.id}/confirm`, {})).status).toBe(409);
    // And the slot is free again.
    expect(
      (
        await post("/v1/bookings", {
          resource_id: id,
          starts_at: at(12),
          ends_at: at(13),
          customer_name: "X",
        })
      ).status,
    ).toBe(201);
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
  });

  it("is idempotent under a key, and refuses the key with a different body", async () => {
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
    expect(c.status).toBe(422);
  });
});

describe("webhooks", () => {
  it("signs what it sends, and the signature verifies", async () => {
    const sig = await sign("s", "1700000000", '{"a":1}');
    expect(await verifySignature("s", `t=1700000000,v1=${sig}`, '{"a":1}', 1700000100)).toBe(true);
    expect(await verifySignature("s", `t=1700000000,v1=${sig}`, '{"a":2}', 1700000100)).toBe(false);
    expect(await verifySignature("s", `t=1700000000,v1=${sig}`, '{"a":1}', 1700009999)).toBe(false);
  });

  it("records a delivery for an event, attempts it, and schedules a retry when it fails", async () => {
    const created = await post("/v1/webhooks", {
      url: "https://127.0.0.1:9/unreachable",
      events: ["booking.confirmed"],
    });
    expect(created.status).toBe(201);
    const hook = (await created.json()) as { id: string; secret: string };
    expect(hook.secret).toMatch(/^whsec_/);

    const id = await makeResource();
    await post("/v1/bookings", {
      resource_id: id,
      starts_at: at(9),
      ends_at: at(10),
      customer_name: "W",
    });
    // The attempt ran in the background; give it a moment, then read the record.
    await new Promise((r) => setTimeout(r, 300));
    const list = (await (await call("/v1/webhooks/deliveries")).json()) as {
      event: string;
      attempts: number;
      delivered_at: string | null;
      next_attempt_at: string | null;
    }[];
    const d = list.find((x) => x.event === "booking.confirmed");
    expect(d).toBeTruthy();
    expect(d!.attempts).toBe(1);
    expect(d!.delivered_at).toBeNull();
    expect(d!.next_attempt_at).toBeTruthy();

    expect((await call(`/v1/webhooks/${hook.id}`, { method: "DELETE" })).status).toBe(204);
  });
});

describe("payments", () => {
  const signed = async (body: object, secret = "whsec_test") => {
    const raw = JSON.stringify(body);
    const t = String(Math.floor(Date.now() / 1000));
    const v1 = await sign(secret, t, raw);
    return SELF.fetch("https://slot.test/v1/payments/webhook", {
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
    expect(
      (
        await signed(
          {
            provider_ref: "pay_bad",
            booking_id: b.id,
            amount_minor: 1,
            currency: "GBP",
            status: "succeeded",
          },
          "wrong",
        )
      ).status,
    ).toBe(400);
  });
});

describe("cron", () => {
  it("cancels expired holds and emits hold.expired", async () => {
    await post("/v1/webhooks", {
      url: "https://127.0.0.1:9/unreachable",
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

    const ctx = createExecutionContext();
    await worker.scheduled(
      { scheduledTime: Date.now(), cron: "*/5 * * * *", noRetry() {} } as unknown as ScheduledEvent,
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const row = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
      .bind(held.id)
      .first<{ status: string }>();
    expect(row?.status).toBe("cancelled");
    const list = (await (await call("/v1/webhooks/deliveries")).json()) as { event: string }[];
    expect(list.some((d) => d.event === "hold.expired")).toBe(true);
  });
});
