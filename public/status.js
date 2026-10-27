// @ts-check
/** The status page: the hour-by-hour chart, the per-endpoint table, and the visitor's own round trip. */
import { statusData } from "/portal.js";

/** @returns {any} */
const $ = (sel) => document.querySelector(sel);
const ms = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)} ms`);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

statusData.then((s) => {
  const headline = $("[data-status-headline]");
  if (!s) {
    headline.textContent = "Status unavailable";
    return;
  }
  const slow = (s.overall.p95 ?? 0) > 500;
  headline.textContent =
    s.overall.count === 0
      ? "No API traffic in the last day"
      : slow
        ? "Slower than usual"
        : "All endpoints answering";
  document.querySelectorAll(".doc-head .dot").forEach((d) => d.classList.toggle("warn", slow));

  // Hour by hour: p95 as bars, p50 as a line, on one millisecond axis.
  const svg = $("[data-hourly]");
  // Always the last 24 hours, so one busy hour is one bar in its place rather than the whole chart.
  const byHour = new Map(s.hourly.map((h) => [h.hour, h]));
  const now = new Date(s.generated_at ?? Date.now());
  now.setUTCMinutes(0, 0, 0);
  const hours = Array.from({ length: 24 }, (_, i) => {
    const hour = new Date(now.getTime() - (23 - i) * 3_600_000).toISOString().slice(0, 13) + ":00Z";
    return byHour.get(hour) ?? { hour, count: 0, p50: null, p95: null, p99: null };
  });
  const W = 960;
  const H = 200;
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const max = Math.max(50, ...hours.map((h) => h.p95 ?? 0));
  const top = Math.ceil(max / 50) * 50;
  const x = (i) => pad.l + (i + 0.5) * ((W - pad.l - pad.r) / Math.max(hours.length, 1));
  const y = (v) => H - pad.b - (v / top) * (H - pad.t - pad.b);
  const bw = Math.max(4, ((W - pad.l - pad.r) / Math.max(hours.length, 1)) * 0.56);
  const grid = [0, 0.5, 1]
    .map(
      (f) =>
        `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="var(--line)"/><text x="${pad.l - 8}" y="${y(top * f) + 4}" text-anchor="end" font-size="11" fill="var(--mute)" font-family="var(--mono)">${Math.round(top * f)}</text>`,
    )
    .join("");
  const bars = hours
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.count > 0)
    .map(
      ({ h, i }) =>
        `<rect x="${x(i) - bw / 2}" y="${y(h.p95 ?? 0)}" width="${bw}" height="${Math.max(1, H - pad.b - y(h.p95 ?? 0))}" rx="3" fill="var(--accent)" opacity=".85"><title>${h.hour.slice(11, 16)} UTC · p95 ${ms(h.p95)} · p50 ${ms(h.p50)} · ${h.count} requests</title></rect>`,
    )
    .join("");
  const dots = hours
    .map((h, i) =>
      h.count > 0 ? `<circle cx="${x(i)}" cy="${y(h.p50 ?? 0)}" r="3.5" fill="var(--info)"/>` : "",
    )
    .join("");
  const line = `${hours
    .map((h, i) =>
      h.count > 0 && hours[i + 1]?.count > 0
        ? `<line x1="${x(i)}" y1="${y(h.p50 ?? 0)}" x2="${x(i + 1)}" y2="${y(hours[i + 1].p50 ?? 0)}" stroke="var(--info)" stroke-width="2"/>`
        : "",
    )
    .join("")}${dots}`;
  const labels = hours
    .map((h, i) =>
      i % 3 === 0
        ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--mute)" font-family="var(--mono)">${h.hour.slice(11, 16)}</text>`
        : "",
    )
    .join("");
  svg.innerHTML = grid + bars + line + labels;
  const busy = hours.filter((h) => h.count > 0).length;
  $("[data-hourly-note]").textContent = busy
    ? `${busy} of the last 24 hours had traffic · UTC`
    : "no traffic yet";

  const worst = Math.max(1, ...s.operations.map((o) => o.p95 ?? 0));
  $("[data-ops]").innerHTML = s.operations.length
    ? s.operations
        .map((o) => {
          const [method, path] = o.operation.split(" ");
          return `<tr><td><span class="m ${method.toLowerCase()}">${method}</span> <code>${esc(path)}</code></td><td class="num">${o.count}</td><td class="num">${ms(o.p50)}</td><td class="num">${ms(o.p95)}</td><td class="num">${ms(o.p99)}</td><td><div class="bar" aria-hidden="true"><i style="width:${((o.p95 ?? 0) / worst) * 100}%"></i></div></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6" class="muted">No API requests in the last day.</td></tr>';
  if (s.colo) $("[data-colo]").textContent = `round trip to ${s.colo}, median of 5`;
});

// The visitor's own network: five small requests to the edge, median round trip.
(async () => {
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    try {
      await (await fetch("/health", { cache: "no-store" })).text();
      times.push(performance.now() - t0);
    } catch {
      /* offline */
    }
  }
  times.sort((a, b) => a - b);
  $("[data-rtt]").innerHTML = times.length
    ? `${Math.round(times[Math.floor(times.length / 2)])}<small> ms</small>`
    : "—";
})();
