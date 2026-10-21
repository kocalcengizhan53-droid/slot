/**
 * Time, done once, carefully.
 *
 * Everything stored is an instant in UTC. Everything a human types is a wall-clock time in a
 * named zone — "Tuesday at 09:00 in Istanbul" — and the gap between the two is where booking
 * systems go wrong twice a year. These functions cross that gap using only `Intl`, which the
 * Workers runtime has and which knows every zone's rules, so there is no offset table to be
 * stale and no dependency to carry.
 */

export type LocalDate = { year: number; month: number; day: number }; // month 1–12
export type LocalParts = LocalDate & { hour: number; minute: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The wall-clock parts of an instant in a zone. */
export function partsInZone(
  instant: Date,
  timeZone: string,
): LocalParts & { weekday: number; second: number } {
  const get = (type: string) =>
    formatter(timeZone)
      .formatToParts(instant)
      .find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** A zone's offset from UTC at an instant, in minutes. */
export function offsetAt(instant: Date, timeZone: string): number {
  const p = partsInZone(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * Two guesses are enough: assume the offset at the UTC reading of the parts, then correct
 * with the offset at that instant, which catches the day the clocks move. A time that does
 * not exist (the spring-forward gap) lands on the instant after the gap; a time that exists
 * twice (the autumn fold) takes the first.
 */
export function zonedToUtc(parts: LocalParts, timeZone: string): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const first = naive - offsetAt(new Date(naive), timeZone) * 60_000;
  const second = naive - offsetAt(new Date(first), timeZone) * 60_000;
  return new Date(second);
}

/** The instant a local day starts, and the next day's start, in a zone. */
export function dayBounds(date: LocalDate, timeZone: string): { start: Date; end: Date } {
  const start = zonedToUtc({ ...date, hour: 0, minute: 0 }, timeZone);
  const next = addDays(date, 1);
  const end = zonedToUtc({ ...next, hour: 0, minute: 0 }, timeZone);
  return { start, end };
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The weekday (0 = Sunday) of a local date — a pure calendar question, zone-independent. */
export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** "2026-10-22" → parts, or null. Strict: no times, no zones, no shortcuts. */
export function parseLocalDate(text: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (check.getUTCMonth() + 1 !== date.month || check.getUTCDate() !== date.day) return null;
  return date;
}

export const formatLocalDate = (d: LocalDate) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** ISO 8601 in UTC, to the second, with a Z — the one format every stored instant uses. */
export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** Two half-open ranges overlap when each starts before the other ends. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** A valid IANA zone, by asking Intl. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}
