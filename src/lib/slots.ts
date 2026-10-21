import {
  addDays,
  formatLocalDate,
  iso,
  overlaps,
  partsInZone,
  weekdayOf,
  zonedToUtc,
  type LocalDate,
} from "./time";

/**
 * Availability, the arithmetic.
 *
 * A resource is open when a weekly rule says so, in its own zone. Those windows are cut into
 * slots, each slot becomes an instant in UTC, and the bookings already on the resource take
 * capacity away from the slots they overlap. What is left is what can be booked. Pure, so
 * the API and the tests share it exactly.
 */

export type Rule = { weekday: number; start_minute: number; end_minute: number };
export type Busy = { starts_at: string; ends_at: string };

export type Slot = {
  /** ISO UTC. */
  starts_at: string;
  ends_at: string;
  /** The same slot in the resource's zone, for a human: "2026-10-22T09:00". */
  local: string;
  /** How many more bookings this slot can take. */
  available: number;
};

/**
 * The slots of one local day.
 *
 * Rules may overlap or abut; each one is cut independently, so a rule 09:00–12:00 and a rule
 * 12:00–17:00 give the same slots as one 09:00–17:00 would. A slot that does not fit whole
 * before a window's end is not offered.
 */
export function slotsForDay(
  date: LocalDate,
  timeZone: string,
  slotMinutes: number,
  capacity: number,
  rules: readonly Rule[],
  busy: readonly Busy[],
): Slot[] {
  const weekday = weekdayOf(date);
  const out = new Map<string, Slot>();

  for (const rule of rules) {
    if (rule.weekday !== weekday) continue;
    for (let m = rule.start_minute; m + slotMinutes <= rule.end_minute; m += slotMinutes) {
      const startLocal = { ...date, hour: Math.floor(m / 60), minute: m % 60 };
      const endMinute = m + slotMinutes;
      // A window that ends at 24:00 ends at the next day's midnight.
      const endLocal =
        endMinute >= 1440
          ? { ...addDays(date, 1), hour: 0, minute: 0 }
          : { ...date, hour: Math.floor(endMinute / 60), minute: endMinute % 60 };
      const starts_at = iso(zonedToUtc(startLocal, timeZone));
      const ends_at = iso(zonedToUtc(endLocal, timeZone));
      if (ends_at <= starts_at) continue; // swallowed by a clock change
      if (out.has(starts_at)) continue;
      const taken = busy.filter((b) => overlaps(starts_at, ends_at, b.starts_at, b.ends_at)).length;
      out.set(starts_at, {
        starts_at,
        ends_at,
        local: `${formatLocalDate(date)}T${String(startLocal.hour).padStart(2, "0")}:${String(startLocal.minute).padStart(2, "0")}`,
        available: Math.max(0, capacity - taken),
      });
    }
  }

  return [...out.values()].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1));
}

/** Is a proposed booking inside an open window, on slot boundaries, and under capacity? */
export function canBook(
  starts_at: string,
  ends_at: string,
  timeZone: string,
  slotMinutes: number,
  capacity: number,
  rules: readonly Rule[],
  busy: readonly Busy[],
): { ok: true } | { ok: false; reason: "outside_hours" | "off_grid" | "full" } {
  // The booking must be covered by consecutive offered slots.
  const start = new Date(starts_at);
  const localStart = partsInZone(start, timeZone);
  const day = { year: localStart.year, month: localStart.month, day: localStart.day };
  const offered = [
    ...slotsForDay(addDays(day, -1), timeZone, slotMinutes, capacity, rules, []),
    ...slotsForDay(day, timeZone, slotMinutes, capacity, rules, []),
  ];
  const first = offered.find((s) => s.starts_at === starts_at);
  if (!first) {
    const insideAny = offered.some((s) => s.starts_at <= starts_at && starts_at < s.ends_at);
    return { ok: false, reason: insideAny ? "off_grid" : "outside_hours" };
  }
  let cursor = first;
  while (cursor.ends_at < ends_at) {
    const next = offered.find((s) => s.starts_at === cursor.ends_at);
    if (!next) return { ok: false, reason: "outside_hours" };
    cursor = next;
  }
  if (cursor.ends_at !== ends_at) return { ok: false, reason: "off_grid" };

  const taken = busy.filter((b) => overlaps(starts_at, ends_at, b.starts_at, b.ends_at)).length;
  if (taken >= capacity) return { ok: false, reason: "full" };
  return { ok: true };
}
