// @ts-check
/**
 * "When the receiver is down": one delivery's attempts on a timeline, for a receiver that
 * fails a chosen number of times. The schedule is the API's own — the page is rendered with
 * `BACKOFF_MINUTES` from src/events.ts in `data-backoff` — so the minutes here cannot drift
 * from the ones the cron uses. Time is drawn on a log scale: the first minute and the twelfth
 * hour both need to be visible.
 */

const root = document.querySelector("[data-retry]");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** What a failing receiver tends to say, in turn. */
const FAILURES = [
  { code: "503", error: "HTTP 503" },
  { code: "timeout", error: "no answer" },
  { code: "502", error: "HTTP 502" },
  { code: "500", error: "HTTP 500" },
  { code: "503", error: "HTTP 503" },
  { code: "timeout", error: "no answer" },
];

/** @param {number} m */
const when = (m) => (m === 0 ? "T+0" : m < 60 ? `+${m} min` : `+${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);
/** @param {number} m */
const span = (m) => (m < 60 ? `${m} minute${m === 1 ? "" : "s"}` : `${Math.floor(m / 60)} h ${m % 60} min`);

if (root instanceof HTMLElement) {
  const backoff = /** @type {number[]} */ (JSON.parse(root.dataset.backoff ?? "[]"));
  const timeout = Number(root.dataset.timeout ?? 8);
  const tries = backoff.length + 1;
  // Minutes after the event at which each attempt is due.
  const at = [0];
  for (const m of backoff) at.push(at[at.length - 1] + m);
  const end = at[at.length - 1];
  const x = (/** @type {number} */ m) => (Math.log1p(m) / Math.log1p(end)) * 100;

  const track = /** @type {HTMLElement} */ (root.querySelector("[data-retry-track]"));
  const log = /** @type {HTMLElement} */ (root.querySelector("[data-retry-log]"));
  const out = /** @type {HTMLElement} */ (root.querySelector("[data-retry-out]"));
  const buttons = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll("[data-fails]")]);

  track.innerHTML = `<span class="rail"><i class="fill"></i></span>${at
    .map(
      (m, i) =>
        `<span class="stop" style="--x:${x(m)}%" data-stop="${i}"><b class="code"></b><i class="node"></i><small>${when(m)}</small></span>`,
    )
    .join("")}<span class="env" aria-hidden="true"><svg viewBox="0 0 20 14"><rect x="1" y="1" width="18" height="12" rx="2"/><path d="M1.5 2 10 8l8.5-6"/></svg></span>`;
  const fill = /** @type {HTMLElement} */ (track.querySelector(".fill"));
  const env = /** @type {HTMLElement} */ (track.querySelector(".env"));
  const stops = /** @type {HTMLElement[]} */ ([...track.querySelectorAll(".stop")]);

  let token = 0;
  const pause = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

  const play = async (/** @type {number} */ fails) => {
    const mine = ++token;
    for (const b of buttons) b.setAttribute("aria-pressed", String(Number(b.dataset.fails) === fails));
    log.innerHTML = "";
    out.textContent = "";
    track.dataset.state = "running";
    for (const s of stops) {
      s.dataset.state = "";
      /** @type {HTMLElement} */ (s.querySelector(".code")).textContent = "";
    }
    fill.style.width = "0%";
    env.style.left = "0%";
    env.dataset.state = "";

    for (let i = 0; i < tries; i++) {
      if (mine !== token) return;
      env.style.left = `${x(at[i])}%`;
      fill.style.width = `${x(at[i])}%`;
      await pause(i === 0 ? 350 : 800);
      if (mine !== token) return;
      const ok = i >= fails;
      const f = FAILURES[i % FAILURES.length];
      const stop = stops[i];
      stop.dataset.state = ok ? "ok" : "fail";
      /** @type {HTMLElement} */ (stop.querySelector(".code")).textContent = ok ? "200" : f.code;
      const next = backoff[i];
      const row = document.createElement("li");
      row.dataset.state = ok ? "ok" : "fail";
      row.innerHTML = `<span class="n">#${i + 1}</span><span class="t">${when(at[i])}</span><span class="s">${ok ? "200" : f.code}</span><span class="d">${
        ok
          ? `delivered${i ? ` — ${span(at[i])} after the event` : ""}`
          : next === undefined
            ? `${f.error === "no answer" ? `no answer in ${timeout} s` : f.error} — no more tries; the delivery stays readable as failed`
            : `${f.error === "no answer" ? `no answer in ${timeout} s` : f.error} — next try due in ${span(next)}`
      }</span>`;
      log.append(row);
      if (ok) {
        env.dataset.state = "ok";
        track.dataset.state = "done";
        out.textContent =
          i === 0
            ? "Delivered on the first try, the moment the event happened."
            : `Delivered on attempt ${i + 1}, ${span(at[i])} after the event. Nothing was lost while the receiver was down.`;
        return;
      }
      await pause(260);
    }
    env.dataset.state = "gone";
    track.dataset.state = "done";
    out.textContent = `${tries} tries over ${span(end)}, then the delivery is marked failed. It stays in the list with every attempt's status, so it can be found and replayed.`;
  };

  for (const b of buttons) b.addEventListener("click", () => play(Number(b.dataset.fails)));
  const initial = Number(buttons.find((b) => b.getAttribute("aria-pressed") === "true")?.dataset.fails ?? 3);
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      play(initial);
    }
  }, { threshold: 0.35 }).observe(root);
}

export {};
