// @ts-check
/**
 * "One booking, every clock": a London wall-clock time on a chosen day, turned into the UTC
 * instant(s) it names and shown on five clocks. The conversion uses Intl only, as the API does:
 * a local time the clocks skip names no instant, and one they repeat names two.
 */

const root = document.querySelector("[data-tz]");
const HOME = "Europe/London";
const CITIES = [
  { zone: HOME, city: "London", note: "the resource" },
  { zone: "America/New_York", city: "New York" },
  { zone: "Europe/Istanbul", city: "Istanbul" },
  { zone: "Asia/Tokyo", city: "Tokyo" },
  { zone: "Australia/Sydney", city: "Sydney" },
];

/** @param {string} zone @param {number} ms */
function partsIn(zone, ms) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute };
}

/** Minutes the zone is ahead of UTC at an instant. @param {string} zone @param {number} ms */
function offset(zone, ms) {
  const p = partsIn(zone, ms);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000) / 60_000;
}

/**
 * Every instant at which the zone's clock reads this local time: none in a skipped hour, two in
 * a repeated one. Try the offset in force half a day before and half a day after, keep the ones
 * that read back as the same local time.
 * @param {string} zone @param {number} y @param {number} m @param {number} d @param {number} h @param {number} mi
 */
function instants(zone, y, m, d, h, mi) {
  const naive = Date.UTC(y, m - 1, d, h, mi);
  const found = new Set();
  for (const guess of [offset(zone, naive - 43_200_000), offset(zone, naive + 43_200_000)]) {
    const ms = naive - guess * 60_000;
    const p = partsIn(zone, ms);
    if (p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi) found.add(ms);
  }
  return [...found].sort((a, b) => a - b);
}

const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
const utc = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(11, 16);

/** An analogue face for a clock: hands turned to the time, the dial shaded for night. */
function face(/** @type {number} */ h, /** @type {number} */ mi) {
  const hand = (deg, len, w) =>
    `<line x1="24" y1="24" x2="24" y2="${24 - len}" stroke-width="${w}" stroke-linecap="round" style="transform:rotate(${deg}deg);transform-origin:24px 24px"/>`;
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI;
    return `<circle cx="${(24 + 18.5 * Math.sin(a)).toFixed(1)}" cy="${(24 - 18.5 * Math.cos(a)).toFixed(1)}" r="${i % 3 ? 0.8 : 1.4}"/>`;
  }).join("");
  return `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="dial" cx="24" cy="24" r="22"/><g class="ticks">${ticks}</g><g class="hands">${hand(((h % 12) + mi / 60) * 30, 11, 2.4)}${hand(mi * 6, 16, 1.6)}</g><circle class="pin" cx="24" cy="24" r="1.8"/></svg>`;
}

if (root) {
  const days = [...root.querySelectorAll("[data-day]")];
  const slider = /** @type {HTMLInputElement} */ (root.querySelector("[data-tz-time]"));
  const local = root.querySelector("[data-tz-local]");
  const note = root.querySelector("[data-tz-note]");
  const hours = root.querySelector("[data-tz-hours]");
  const list = root.querySelector("[data-tz-clocks]");
  let day = days[0]?.getAttribute("data-day") ?? "2026-10-20";

  const render = () => {
    const [y, m, d] = day.split("-").map(Number);
    const step = Number(slider.value);
    const h = Math.floor(step / 2);
    const mi = (step % 2) * 30;
    if (local) local.textContent = `${pad(h)}:${pad(mi)}`;
    const found = instants(HOME, y, m, d, h, mi);

    // How long the London day is: midnight to midnight, both of which always exist.
    const start = instants(HOME, y, m, d, 0, 0)[0];
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const end = instants(HOME, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0)[0];
    if (hours) hours.textContent = String(Math.round((end - start) / 3_600_000));

    if (note)
      note.textContent =
        found.length === 0
          ? `${pad(h)}:${pad(mi)} does not happen in London that day — the clocks jump past it, so Slot never offers it.`
          : found.length === 2
            ? `${pad(h)}:${pad(mi)} happens twice in London that day: ${utc(found[0])} and ${utc(found[1])} UTC. Two instants, two different bookings.`
            : `One instant: ${utc(found[0])} UTC.`;
    root.toggleAttribute("data-gap", found.length === 0);

    const homeDate = `${y}${pad(m)}${pad(d)}`;
    if (list)
      list.innerHTML = CITIES.map((c) => {
        if (!found.length)
          return `<li class="clock skipped"><div class="face">${face(h, mi)}</div><div><b>${c.city}</b><span class="mono">no such time</span></div></li>`;
        const rows = found.map((ms) => {
          const p = partsIn(c.zone, ms);
          const rel = Math.sign(Number(`${p.y}${pad(p.m)}${pad(p.d)}`) - Number(homeDate));
          const off = new Intl.DateTimeFormat("en-GB", { timeZone: c.zone, timeZoneName: "shortOffset" })
            .formatToParts(ms)
            .find((x) => x.type === "timeZoneName")?.value;
          return { p, rel, off };
        });
        const first = rows[0].p;
        const night = first.h < 6 || first.h >= 19;
        return `<li class="clock${night ? " night" : ""}"><div class="face">${face(first.h, first.mi)}</div><div><b>${c.city}</b>${c.note ? `<small>${c.note}</small>` : ""}${rows
          .map(
            (r) =>
              `<span class="mono">${pad(r.p.h)}:${pad(r.p.mi)}${r.rel ? `<em>${r.rel > 0 ? "+1 day" : "−1 day"}</em>` : ""} <i>${r.off}</i></span>`,
          )
          .join("")}</div></li>`;
      }).join("");
  };

  for (const b of days)
    b.addEventListener("click", () => {
      day = b.getAttribute("data-day") ?? day;
      for (const o of days) o.setAttribute("aria-pressed", String(o === b));
      // Land on the interesting hour: the one the clocks skip or repeat.
      if (day !== "2026-10-20") slider.value = "3";
      render();
    });
  slider.addEventListener("input", render);
  render();
}

// Loaded as a module; this keeps its top-level names its own.
export {};
