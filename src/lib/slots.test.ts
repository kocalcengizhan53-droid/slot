import { describe, expect, it } from "vitest";

import { canBook, slotsForDay, type Rule } from "./slots";

const istanbul = "Europe/Istanbul";
const thursday = { year: 2026, month: 10, day: 22 }; // a Thursday, weekday 4
const nineToFive: Rule[] = [{ weekday: 4, start_minute: 9 * 60, end_minute: 17 * 60 }];

describe("slotsForDay", () => {
  it("cuts an open window into whole slots, in UTC, with the local reading beside each", () => {
    const slots = slotsForDay(thursday, istanbul, 60, 1, nineToFive, []);
    expect(slots).toHaveLength(8);
    expect(slots[0]).toMatchObject({
      starts_at: "2026-10-22T06:00:00Z",
      local: "2026-10-22T09:00",
      available: 1,
    });
    expect(slots[7]).toMatchObject({
      starts_at: "2026-10-22T13:00:00Z",
      ends_at: "2026-10-22T14:00:00Z",
    });
  });

  it("offers nothing on a closed day", () => {
    expect(
      slotsForDay({ year: 2026, month: 10, day: 24 }, istanbul, 60, 1, nineToFive, []),
    ).toEqual([]);
  });

  it("does not offer a slot that would not fit before closing", () => {
    const slots = slotsForDay(thursday, istanbul, 45, 1, nineToFive, []);
    // 09:00 → 16:30 fits ten 45-minute slots; 16:30–17:15 would not.
    expect(slots).toHaveLength(10);
    expect(slots.at(-1)?.local).toBe("2026-10-22T15:45");
  });

  it("takes capacity away from the slots a booking overlaps, and only those", () => {
    const busy = [{ starts_at: "2026-10-22T07:30:00Z", ends_at: "2026-10-22T08:30:00Z" }]; // 10:30–11:30 local
    const slots = slotsForDay(thursday, istanbul, 60, 1, nineToFive, busy);
    expect(slots.map((s) => s.available)).toEqual([1, 0, 0, 1, 1, 1, 1, 1]);
  });

  it("counts capacity: a class of three is full after three", () => {
    const b = { starts_at: "2026-10-22T06:00:00Z", ends_at: "2026-10-22T07:00:00Z" };
    expect(slotsForDay(thursday, istanbul, 60, 3, nineToFive, [b, b])[0].available).toBe(1);
    expect(slotsForDay(thursday, istanbul, 60, 3, nineToFive, [b, b, b])[0].available).toBe(0);
  });

  it("two abutting rules give the same slots as one long one", () => {
    const split: Rule[] = [
      { weekday: 4, start_minute: 9 * 60, end_minute: 12 * 60 },
      { weekday: 4, start_minute: 12 * 60, end_minute: 17 * 60 },
    ];
    expect(slotsForDay(thursday, istanbul, 60, 1, split, [])).toEqual(
      slotsForDay(thursday, istanbul, 60, 1, nineToFive, []),
    );
  });

  it("survives the day the clocks go forward: the 01:30 slot is not offered twice or at all", () => {
    // London, 29 March 2026: 01:00 → 02:00. A rule open 00:00–04:00 in 30-minute slots.
    const sunday = { year: 2026, month: 3, day: 29 };
    const rules: Rule[] = [{ weekday: 0, start_minute: 0, end_minute: 4 * 60 }];
    const slots = slotsForDay(sunday, "Europe/London", 30, 1, rules, []);
    const starts = slots.map((s) => s.starts_at);
    expect(new Set(starts).size).toBe(starts.length);
    // Three real hours between 00:00 and 04:00 that night: six slots, not eight.
    expect(slots).toHaveLength(6);
  });
});

describe("canBook", () => {
  const busy = [{ starts_at: "2026-10-22T08:00:00Z", ends_at: "2026-10-22T09:00:00Z" }];

  it("accepts a booking on the grid inside the hours with room", () => {
    expect(
      canBook("2026-10-22T06:00:00Z", "2026-10-22T08:00:00Z", istanbul, 60, 1, nineToFive, busy),
    ).toEqual({ ok: true });
  });

  it("rejects one that is full", () => {
    expect(
      canBook("2026-10-22T08:00:00Z", "2026-10-22T09:00:00Z", istanbul, 60, 1, nineToFive, busy),
    ).toEqual({ ok: false, reason: "full" });
  });

  it("rejects one off the slot grid", () => {
    expect(
      canBook("2026-10-22T06:15:00Z", "2026-10-22T07:15:00Z", istanbul, 60, 1, nineToFive, []),
    ).toEqual({ ok: false, reason: "off_grid" });
    expect(
      canBook("2026-10-22T06:00:00Z", "2026-10-22T07:30:00Z", istanbul, 60, 1, nineToFive, []),
    ).toEqual({ ok: false, reason: "off_grid" });
  });

  it("rejects one outside the hours, including one that runs past closing", () => {
    expect(
      canBook("2026-10-22T04:00:00Z", "2026-10-22T05:00:00Z", istanbul, 60, 1, nineToFive, []),
    ).toEqual({ ok: false, reason: "outside_hours" });
    expect(
      canBook("2026-10-22T13:00:00Z", "2026-10-22T15:00:00Z", istanbul, 60, 1, nineToFive, []),
    ).toEqual({ ok: false, reason: "outside_hours" });
  });
});
