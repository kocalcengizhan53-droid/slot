import { describe, expect, it } from "vitest";

import {
  addDays,
  dayBounds,
  iso,
  isTimeZone,
  offsetAt,
  overlaps,
  parseLocalDate,
  partsInZone,
  weekdayOf,
  zonedToUtc,
} from "./time";

describe("zonedToUtc", () => {
  it("turns Istanbul wall-clock time into the right instant", () => {
    // Türkiye is UTC+3 all year.
    expect(
      iso(zonedToUtc({ year: 2026, month: 10, day: 22, hour: 9, minute: 0 }, "Europe/Istanbul")),
    ).toBe("2026-10-22T06:00:00Z");
  });

  it("knows which side of the clock change New York is on", () => {
    // 2026: EDT ends Sunday 1 November. 09:00 local is 13:00Z before, 14:00Z after.
    expect(
      iso(zonedToUtc({ year: 2026, month: 10, day: 31, hour: 9, minute: 0 }, "America/New_York")),
    ).toBe("2026-10-31T13:00:00Z");
    expect(
      iso(zonedToUtc({ year: 2026, month: 11, day: 2, hour: 9, minute: 0 }, "America/New_York")),
    ).toBe("2026-11-02T14:00:00Z");
  });

  it("lands a time that does not exist on the instant after the gap", () => {
    // London springs forward 29 March 2026 at 01:00 → 02:00. 01:30 local never happens.
    const d = zonedToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, "Europe/London");
    expect(iso(d)).toBe("2026-03-29T01:30:00Z"); // read back as 02:30 BST, the instant after
    expect(partsInZone(d, "Europe/London").hour).toBe(2);
  });

  it("round-trips through partsInZone", () => {
    for (const zone of [
      "Europe/Istanbul",
      "America/Los_Angeles",
      "Asia/Kolkata",
      "Pacific/Auckland",
    ]) {
      const parts = { year: 2026, month: 7, day: 14, hour: 18, minute: 45 };
      const back = partsInZone(zonedToUtc(parts, zone), zone);
      expect({ ...back, second: 0, weekday: 0 }).toMatchObject({ ...parts, second: 0, weekday: 0 });
    }
  });
});

describe("dayBounds", () => {
  it("is 24 hours on an ordinary day and 23 or 25 across a change", () => {
    const ordinary = dayBounds({ year: 2026, month: 6, day: 10 }, "Europe/London");
    expect((ordinary.end.getTime() - ordinary.start.getTime()) / 3_600_000).toBe(24);
    const short = dayBounds({ year: 2026, month: 3, day: 29 }, "Europe/London");
    expect((short.end.getTime() - short.start.getTime()) / 3_600_000).toBe(23);
    const long = dayBounds({ year: 2026, month: 10, day: 25 }, "Europe/London");
    expect((long.end.getTime() - long.start.getTime()) / 3_600_000).toBe(25);
  });
});

it("offsetAt reads the zone's offset at that instant", () => {
  expect(offsetAt(new Date("2026-07-01T12:00:00Z"), "Europe/Istanbul")).toBe(180);
  expect(offsetAt(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
  expect(offsetAt(new Date("2026-01-01T12:00:00Z"), "America/New_York")).toBe(-300);
});

it("calendar helpers", () => {
  expect(addDays({ year: 2026, month: 2, day: 28 }, 1)).toEqual({ year: 2026, month: 3, day: 1 });
  expect(weekdayOf({ year: 2026, month: 10, day: 22 })).toBe(4); // a Thursday
  expect(parseLocalDate("2026-10-22")).toEqual({ year: 2026, month: 10, day: 22 });
  expect(parseLocalDate("2026-02-30")).toBeNull();
  expect(parseLocalDate("2026-10-22T09:00")).toBeNull();
});

it("overlaps is half-open: touching ranges do not overlap", () => {
  expect(
    overlaps(
      "2026-10-22T09:00:00Z",
      "2026-10-22T10:00:00Z",
      "2026-10-22T10:00:00Z",
      "2026-10-22T11:00:00Z",
    ),
  ).toBe(false);
  expect(
    overlaps(
      "2026-10-22T09:00:00Z",
      "2026-10-22T10:00:00Z",
      "2026-10-22T09:30:00Z",
      "2026-10-22T11:00:00Z",
    ),
  ).toBe(true);
});

it("isTimeZone asks Intl", () => {
  expect(isTimeZone("Europe/Istanbul")).toBe(true);
  expect(isTimeZone("Mars/Olympus")).toBe(false);
});
