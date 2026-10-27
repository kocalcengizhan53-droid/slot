import { env } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";

import { db } from "../src/db";

/**
 * The two places where concurrent requests could both win, raced at the database: five calls
 * started together, so every one issues its first statement before any of them writes. A
 * check-then-write lets all five through — both tests fail against that version. The single
 * statements the API actually runs let through exactly as many as they should.
 *
 * Over HTTP the test runner happens to serialise requests, so the API tests can show the
 * outcome end to end but cannot prove the race; these can.
 */

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO tenants (id, name, api_key_hash, payment_secret, created_at) VALUES ('ten_race', 'Race', 'h', 's', '2026-10-01T00:00:00Z')",
    ),
    env.DB.prepare(
      "INSERT INTO resources (id, tenant_id, name, timezone, slot_minutes, capacity, created_at) VALUES ('res_race', 'ten_race', 'R', 'UTC', 60, 3, '2026-10-01T00:00:00Z')",
    ),
  ]);
});

it("lets exactly one of five simultaneous claims own an idempotency key", async () => {
  const d = db(env.DB);
  const claims = await Promise.all(
    Array.from({ length: 5 }, (_, i) => d.claimIdempotency("ten_race", "k", `h${i}`)),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
});

it("gives a three-place slot to exactly three of five simultaneous inserts", async () => {
  const d = db(env.DB);
  const inserted = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      d.insertIfRoom(
        {
          id: `bkg_race_${i}`,
          tenant_id: "ten_race",
          resource_id: "res_race",
          starts_at: "2026-11-02T10:00:00Z",
          ends_at: "2026-11-02T11:00:00Z",
          status: "confirmed",
          hold_expires_at: null,
          customer_name: `P${i}`,
          customer_email: null,
          notes: null,
        },
        3,
      ),
    ),
  );
  expect(inserted.filter(Boolean)).toHaveLength(3);
});
