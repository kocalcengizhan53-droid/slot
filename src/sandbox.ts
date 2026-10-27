import { id, sha256, type Booking, type Db, type Resource, type Rule } from "./db";
import { addDays, iso, partsInZone, weekdayOf, zonedToUtc, type LocalDate } from "./lib/time";

/**
 * Sandboxes: a tenant per visitor, for a day.
 *
 * The portal used to share one demo key, published in the repository, which opened one
 * dataset to everyone — anyone could fill the calendar or point its webhooks anywhere. Now
 * each visitor gets a key of their own over a fresh copy of a small studio's calendar. A
 * sandbox is a real tenant with quotas, so nothing one visitor does reaches another, and the
 * cron deletes it with everything it owns when the day is up.
 */

export const SANDBOX_HOURS = 24;
export const SANDBOX_LIMITS = { resources: 10, bookings: 300, webhooks: 3, deliveries: 200 };
/** How many may be alive at once, which bounds the storage they can take. */
export const MAX_LIVE_SANDBOXES = 2000;

const ISTANBUL = "Europe/Istanbul";
const LONDON = "Europe/London";
const WEEKDAYS = [1, 2, 3, 4, 5];

type Seed = {
  resource: Omit<Resource, "created_at" | "tenant_id">;
  hours: { weekday: number; start: number; end: number }[];
};

const hm = (h: number, m = 0) => h * 60 + m;

function studio(): Seed[] {
  return [
    {
      resource: {
        id: id("res"),
        name: "Room A — recording",
        timezone: ISTANBUL,
        slot_minutes: 60,
        capacity: 1,
      },
      hours: WEEKDAYS.map((weekday) => ({ weekday, start: hm(9), end: hm(18) })),
    },
    {
      resource: {
        id: id("res"),
        name: "Room B — rehearsal",
        timezone: ISTANBUL,
        slot_minutes: 30,
        capacity: 1,
      },
      hours: [
        ...WEEKDAYS.map((weekday) => ({ weekday, start: hm(10), end: hm(22) })),
        { weekday: 6, start: hm(10), end: hm(16) },
      ],
    },
    {
      resource: {
        id: id("res"),
        name: "Mixing class",
        timezone: LONDON,
        slot_minutes: 90,
        capacity: 6,
      },
      hours: [2, 4].map((weekday) => ({ weekday, start: hm(18), end: hm(21) })),
    },
  ];
}

/** The next `count` days after today in a zone that fall on one of `weekdays`. */
function nextDays(
  timeZone: string,
  weekdays: number[],
  count: number,
  from = new Date(),
): LocalDate[] {
  const today = partsInZone(from, timeZone);
  const days: LocalDate[] = [];
  for (let d = addDays(today, 1); days.length < count; d = addDays(d, 1))
    if (weekdays.includes(weekdayOf(d))) days.push(d);
  return days;
}

const at = (day: LocalDate, minute: number, timeZone: string) =>
  iso(zonedToUtc({ ...day, hour: Math.floor(minute / 60), minute: minute % 60 }, timeZone));

/** A few bookings over the coming days, so the first availability call has something in it. */
function bookingsFor(
  seeds: Seed[],
  from: Date,
): Omit<Booking, "created_at" | "updated_at" | "tenant_id">[] {
  const [roomA, roomB, mixing] = seeds.map((s) => s.resource);
  const people = [
    ["Deniz Aksoy", "deniz@example.com", "Vocal session"],
    ["Mara Lind", "mara@example.com", null],
    ["The Quays", "band@example.com", "Rehearsal, full band"],
    ["Ola Berg", "ola@example.com", null],
    ["Sam Reyes", "sam@example.com", null],
    ["Ece Kaya", "ece@example.com", "Mix review"],
    ["Jun Park", "jun@example.com", null],
  ] as const;
  const out: Omit<Booking, "created_at" | "updated_at" | "tenant_id">[] = [];
  const add = (r: typeof roomA, day: LocalDate, start: number, end: number, who: number) =>
    out.push({
      id: id("bkg"),
      resource_id: r.id,
      starts_at: at(day, start, r.timezone),
      ends_at: at(day, end, r.timezone),
      status: "confirmed",
      hold_expires_at: null,
      customer_name: people[who][0],
      customer_email: people[who][1],
      notes: people[who][2],
    });
  const [a1, a2, a3] = nextDays(ISTANBUL, WEEKDAYS, 3, from);
  add(roomA, a1, hm(10), hm(12), 0);
  add(roomA, a1, hm(15), hm(16), 1);
  add(roomA, a2, hm(9), hm(10), 5);
  add(roomA, a3, hm(13), hm(15), 6);
  add(roomB, a1, hm(10, 30), hm(11, 30), 2);
  add(roomB, a2, hm(19), hm(21), 2);
  const [c1] = nextDays(LONDON, [2, 4], 1, from);
  for (const who of [3, 4, 0, 1]) add(mixing, c1, hm(18), hm(19, 30), who);
  return out;
}

export async function createSandbox(d: Db, from = new Date()) {
  const apiKey = `sk_test_${crypto.randomUUID().replace(/-/g, "")}`;
  const paymentSecret = `whsec_${crypto.randomUUID().replace(/-/g, "")}`;
  const tenantId = id("ten");
  const expiresAt = iso(new Date(from.getTime() + SANDBOX_HOURS * 3_600_000));
  const seeds = studio();
  const rules: Omit<Rule, "id">[] = seeds.flatMap((s) =>
    s.hours.map((h) => ({
      resource_id: s.resource.id,
      weekday: h.weekday,
      start_minute: h.start,
      end_minute: h.end,
    })),
  );
  await d.createSandbox({
    tenant: {
      id: tenantId,
      name: "Harbour Studio (sandbox)",
      api_key_hash: await sha256(apiKey),
      payment_secret: paymentSecret,
      kind: "sandbox",
      expires_at: expiresAt,
    },
    resources: seeds.map((s) => s.resource),
    rules,
    bookings: bookingsFor(seeds, from),
  });
  return {
    api_key: apiKey,
    payment_secret: paymentSecret,
    tenant_id: tenantId,
    expires_at: expiresAt,
    resources: seeds.map((s) => ({
      id: s.resource.id,
      name: s.resource.name,
      timezone: s.resource.timezone,
    })),
    limits: SANDBOX_LIMITS,
  };
}
