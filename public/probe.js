// @ts-check
/**
 * "Your round trip, measured now": small GETs from this page to /health, one after another,
 * each timed in the browser. Each request is a packet on the wire and a step on a histogram of
 * round trips. (The Worker's own Server-Timing is not shown: a Worker's clock stands still until
 * it does I/O, and /health does none, so it would always read zero.) A dozen go when the panel
 * first comes into view; the button sends more. /health is not an API operation, so none of
 * this is counted into the 24-hour figures beside it.
 */
import { statusData } from "/portal.js";

const root = document.querySelector("[data-probe]");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Upper bounds of the round-trip buckets, ms; the last holds everything slower. */
const BOUNDS = [10, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500, Infinity];
const LABELS = ["10", "20", "30", "40", "50", "75", "100", "150", "200", "300", "500", "500+"];

if (root) {
  const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (root.querySelector(sel));
  const line = $("[data-probe-line]");
  const hist = $("[data-probe-hist]");
  const run = /** @type {HTMLButtonElement} */ ($("[data-probe-run]"));
  /** @type {number[]} */
  const rtts = [];
  const counts = BOUNDS.map(() => 0);

  hist.innerHTML = BOUNDS.map(
    (_, i) => `<span class="col" style="--h:0"><span class="well"><i class="rise"></i><b class="n"></b></span><small>${LABELS[i]}</small></span>`,
  ).join("");
  const cols = [...hist.querySelectorAll(".col")];

  statusData.then((s) => {
    if (s?.colo) $("[data-probe-edge]").textContent = s.colo;
  });

  const median = (/** @type {number[]} */ xs) => {
    const a = [...xs].sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  };

  const draw = () => {
    const top = Math.max(1, ...counts);
    cols.forEach((c, i) => {
      /** @type {HTMLElement} */ (c).style.setProperty("--h", String(counts[i] / top));
      /** @type {HTMLElement} */ (c.querySelector(".n")).textContent = counts[i] ? String(counts[i]) : "";
      c.classList.toggle("lit", counts[i] > 0);
    });
    const r = median(rtts);
    const fastest = rtts.length ? Math.min(...rtts) : null;
    $("[data-probe-rtt]").innerHTML = r === null ? "—" : `${Math.round(r)}<small> ms</small>`;
    $("[data-probe-min]").innerHTML = fastest === null ? "—" : `${Math.round(fastest)}<small> ms</small>`;
    $("[data-probe-n]").textContent = String(rtts.length);
  };

  /** A packet out to the edge and back, at a speed a person can follow. */
  const packet = () => {
    if (reduced) return;
    const dot = document.createElement("i");
    dot.className = "pkt";
    line.append(dot);
    dot
      .animate(
        [
          { left: "0%", opacity: 0 },
          { left: "8%", opacity: 1, offset: 0.06 },
          { left: "calc(100% - 8px)", opacity: 1, offset: 0.48 },
          { left: "calc(100% - 8px)", opacity: 1, background: "var(--ok)", offset: 0.52 },
          { left: "0%", opacity: 0.2, background: "var(--ok)" },
        ],
        { duration: 1100, easing: "cubic-bezier(.4,0,.2,1)" },
      )
      .finished.then(() => dot.remove());
  };

  let busy = false;
  const send = async (/** @type {number} */ n) => {
    if (busy) return;
    busy = true;
    run.disabled = true;
    let failed = 0;
    for (let i = 0; i < n; i++) {
      packet();
      const t0 = performance.now();
      try {
        const res = await fetch("/health", { cache: "no-store" });
        await res.text();
        const ms = performance.now() - t0;
        rtts.push(ms);
        counts[BOUNDS.findIndex((b) => ms <= b)] += 1;
        draw();
      } catch {
        failed += 1;
      }
      // Spaced out, so the wire reads as traffic rather than one blur.
      await new Promise((r) => setTimeout(r, 90));
    }
    const r = median(rtts);
    const edge = $("[data-probe-edge]").textContent;
    $("[data-probe-note]").textContent =
      r === null
        ? "No answer from the edge — are you offline?"
        : `${rtts.length} round trips to ${edge === "—" ? "the edge" : `the edge in ${edge}`}, median ${Math.round(r)} ms — almost all of it the network between you and it.${failed ? ` ${failed} failed.` : ""}`;
    busy = false;
    run.disabled = false;
  };

  run.addEventListener("click", () => send(24));
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      send(12);
    }
  }).observe(root);
}

export {};
