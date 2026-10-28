// @ts-check
/**
 * The portal in the browser: the visitor's sandbox, the code panels and their Run buttons,
 * the race on the home page, the live latency numbers, the theme. Pages that need more import
 * from here (status.js, playground.js), so there is one sandbox and one request function.
 */

/** @returns {any} */
const $ = (sel, root = document) => root.querySelector(sel);
/** @returns {any[]} */
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Storage can be missing or throw (private windows, blocked site data); nothing here depends on it.
const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/* ---------------------------------------------------------------- theme, toast */

$("[data-theme-toggle]")?.addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === "dark"
    : !matchMedia("(prefers-color-scheme: light)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("slot.theme", root.dataset.theme);
  } catch {
    /* ignore */
  }
});

let toastTimer = 0;
export function toast(text) {
  const el = $("[data-toast]");
  if (!el) return;
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("on"), 2600);
}

/* ---------------------------------------------------------------- state */

/**
 * @typedef {{ api_key: string, payment_secret: string, tenant_id: string, expires_at: string,
 *   resources: { id: string, name: string, timezone: string }[] }} Sandbox
 */
export const state = {
  /** @type {Sandbox | null} */ sandbox: null,
  /** @type {{ starts_at: string, ends_at: string, local: string } | null} */ slot: null,
  /** @type {any} */ booking: null,
  /** @type {{ id: string } | null} */ webhook: null,
  idem: crypto.randomUUID(),
};

(function load() {
  const sb = store.get("slot.sandbox");
  if (sb && Date.parse(sb.expires_at) > Date.now() + 60_000) state.sandbox = sb;
  else store.del("slot.sandbox");
  const flow = store.get("slot.flow");
  if (flow && state.sandbox && flow.tenant === state.sandbox.tenant_id) {
    state.slot = flow.slot ?? null;
    state.booking = flow.booking ?? null;
    state.webhook = flow.webhook ?? null;
  }
})();

function save() {
  store.set("slot.flow", {
    tenant: state.sandbox?.tenant_id,
    slot: state.slot,
    booking: state.booking,
    webhook: state.webhook,
  });
}

/** Fills in what a sandbox replaces, everywhere it is shown. */
function changed() {
  save();
  renderKey();
  $$("[data-panel]").forEach(renderPanel);
  document.dispatchEvent(new CustomEvent("slot:state"));
}

export function adoptSandbox(sb) {
  state.sandbox = sb;
  state.slot = state.booking = state.webhook = null;
  state.idem = crypto.randomUUID();
  store.set("slot.sandbox", sb);
  store.del("slot.bookmark");
  changed();
}

/* ---------------------------------------------------------------- requests */

const STATUS_TEXT = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

/**
 * One request to the API, timed, with the visitor's key and the D1 bookmark from their last
 * response, so they always read what they just wrote.
 * @param {string} method @param {string} path
 * @param {{ body?: unknown, raw?: string, headers?: Record<string, string>, auth?: boolean }} [opts]
 */
export async function api(method, path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.auth !== false && state.sandbox)
    headers.authorization = `Bearer ${state.sandbox.api_key}`;
  if (opts.body !== undefined || opts.raw !== undefined)
    headers["content-type"] = "application/json";
  const bookmark = store.get("slot.bookmark");
  if (bookmark) headers["x-d1-bookmark"] = bookmark;
  const t0 = performance.now();
  const res = await fetch(path, {
    method,
    headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const next = res.headers.get("x-d1-bookmark");
  if (next) store.set("slot.bookmark", next);
  const dur = /dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "");
  const result = {
    method,
    path,
    status: res.status,
    json,
    ms,
    server: dur ? Number(dur[1]) : null,
    requestId: res.headers.get("x-request-id"),
    replayed: res.headers.get("idempotent-replayed") === "true",
  };
  document.dispatchEvent(new CustomEvent("slot:request", { detail: result }));
  if (res.status === 401 && json?.code === "sandbox_expired") {
    store.del("slot.sandbox");
    state.sandbox = null;
    changed();
  }
  return result;
}

export async function ensureSandbox() {
  if (state.sandbox) return state.sandbox;
  const r = await api("POST", "/v1/sandbox", { auth: false });
  if (r.status !== 201)
    throw new Error(r.json?.detail ?? `Could not create a sandbox (${r.status})`);
  adoptSandbox(r.json);
  toast("Sandbox created — it is yours for 24 hours.");
  return r.json;
}

export async function hmacHex(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const ymd = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

/* ---------------------------------------------------------------- highlighting */

const RX = {
  shell:
    /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'[^']*')|()((?:^|\s)-{1,2}[A-Za-z][\w-]*|\$\(?[A-Za-z_]\w*)|\b(\d+)\b/g,
  js: /(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(const|let|await|async|function|return|import|from|export|new|if|for|of|try|catch|true|false|null|undefined)\b|()\b(\d+(?:\.\d+)?)\b/g,
  python:
    /(#[^\n]*)|(f?"(?:[^"\\\n]|\\.)*"|f?'(?:[^'\\\n]|\\.)*'|b"[^"]*")|\b(import|from|def|return|for|in|if|while|True|False|None|with|as|yield|print)\b|()\b(\d+(?:\.\d+)?)\b/g,
  json: /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g,
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Wraps comments, strings, keywords and numbers in spans; everything else is escaped as is. */
export function highlight(code, lang) {
  const rx = RX[lang === "curl" ? "shell" : lang] ?? RX.shell;
  let out = "";
  let last = 0;
  rx.lastIndex = 0;
  for (let m = rx.exec(code); m; m = rx.exec(code)) {
    out += esc(code.slice(last, m.index));
    last = m.index + m[0].length;
    if (lang === "json") {
      if (m[1])
        out += `<span class="${m[2] ? "tk-p" : "tk-s"}">${esc(m[1])}</span>${m[2] ? esc(m[2]) : ""}`;
      else if (m[3]) out += `<span class="tk-k">${m[3]}</span>`;
      else out += `<span class="tk-n">${m[4]}</span>`;
      continue;
    }
    const [whole, comment, str, kw, flag, num] = m;
    if (comment) out += `<span class="tk-c">${esc(comment)}</span>`;
    else if (str) out += `<span class="tk-s">${esc(str)}</span>`;
    else if (kw) out += `<span class="tk-k">${esc(kw)}</span>`;
    else if (flag) out += `<span class="tk-f">${esc(flag)}</span>`;
    else if (num) out += `<span class="tk-n">${num}</span>`;
    else out += esc(whole);
  }
  return out + esc(code.slice(last));
}

$$("[data-highlight]").forEach((pre) => {
  const code = pre.querySelector("code") ?? pre;
  code.innerHTML = highlight(code.textContent ?? "", pre.dataset.highlight);
});

/* ---------------------------------------------------------------- code panels */

const PLACEHOLDER = {
  key: "sk_test_…",
  resource_id: "res_…",
  starts_at: "2026-11-02T07:00:00Z",
  ends_at: "2026-11-02T08:00:00Z",
  booking_id: "bkg_…",
  webhook_id: "whk_…",
  payment_secret: "whsec_…",
  provider_ref: "pay_…",
};
/** What a missing value needs, in the words of the step that makes it. */
const NEEDS = {
  starts_at: "a free slot — run “Find a free slot” first",
  ends_at: "a free slot — run “Find a free slot” first",
  booking_id: "a booking — run “Hold the slot” first",
  provider_ref: "a booking — run “Hold the slot” first",
  webhook_id: "a webhook — run “Subscribe to events” first",
};

function tokens() {
  const tomorrow = addDays(new Date(), 1);
  return {
    key: state.sandbox?.api_key ?? null,
    payment_secret: state.sandbox?.payment_secret ?? null,
    resource_id: state.sandbox?.resources[0]?.id ?? null,
    from: ymd(tomorrow),
    to: ymd(addDays(tomorrow, 6)),
    starts_at: state.slot?.starts_at ?? null,
    ends_at: state.slot?.ends_at ?? null,
    booking_id: state.booking?.id ?? null,
    provider_ref: state.booking?.id ? `pay_${state.booking.id.slice(-8)}` : null,
    webhook_id: state.webhook?.id ?? null,
    idem: state.idem,
    sink: `${location.origin}/demo/sink`,
  };
}

const fill = (text, t, display) =>
  text.replace(
    /\{\{(\w+)\}\}/g,
    (_, name) => t[name] ?? (display ? (PLACEHOLDER[name] ?? name) : `{{${name}}}`),
  );

let lang = store.get("slot.lang") ?? "curl";

function renderPanel(panel) {
  if (!panel._data)
    panel._data = JSON.parse(panel.querySelector('script[type="application/json"]').textContent);
  const { snippets } = panel._data;
  const code = fill(snippets[lang], tokens(), true);
  panel.querySelector("pre code").innerHTML = highlight(code, lang);
  for (const tab of panel.querySelectorAll('[role="tab"]')) {
    const on = tab.dataset.lang === lang;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on) panel.querySelector("pre").setAttribute("aria-labelledby", tab.id);
  }
}

function setLang(next) {
  lang = next;
  store.set("slot.lang", lang);
  $$("[data-panel]").forEach(renderPanel);
}

/** Leaves at most three items of any long list, so a week of slots fits in the panel. */
function trim(value) {
  if (Array.isArray(value)) {
    const head = value.slice(0, 3).map(trim);
    return value.length > 4 ? [...head, `… ${value.length - 3} more`] : value.map(trim);
  }
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v)]));
  return value;
}

function showResponse(panel, r) {
  const box = panel.querySelector("[data-response]");
  const group = String(r.status)[0];
  const parts = [
    `<span class="badge s${group}">${r.status} ${STATUS_TEXT[r.status] ?? ""}</span>`,
    r.replayed ? '<span class="badge rp">Idempotent-Replayed</span>' : "",
    `<span>${Math.round(r.ms)} ms total${r.server !== null ? ` · ${Math.round(r.server)} ms server` : ""}</span>`,
    r.requestId ? `<span>${esc(r.requestId)}</span>` : "",
  ];
  const json =
    r.json === null
      ? ""
      : typeof r.json === "string"
        ? r.json
        : JSON.stringify(trim(r.json), null, 2);
  box.innerHTML = `<div class="resp-head">${parts.join("")}</div>${json ? `<div class="resp-body"><pre tabindex="0" aria-label="Response body"><code>${highlight(json, "json")}</code></pre></div>` : ""}`;
  box.hidden = false;
  box.classList.remove("flash");
  void box.offsetWidth;
  box.classList.add("flash");
}

const hint = (panel, text) => {
  const el = panel.querySelector("[data-hint]");
  if (el) el.textContent = text;
};

function keep(after, r) {
  const ok = r.status >= 200 && r.status < 300;
  if (after === "sandbox" && r.status === 201) {
    adoptSandbox(r.json);
    return "Sandbox created. Its key is in every sample on this page now.";
  }
  if (!ok) return null;
  if (after === "slot") {
    const soon = Date.now() + 5 * 60_000;
    for (const day of r.json.days ?? [])
      for (const s of day.slots)
        if (s.available > 0 && Date.parse(s.starts_at) > soon) {
          state.slot = { starts_at: s.starts_at, ends_at: s.ends_at, local: s.local };
          state.idem = crypto.randomUUID();
          changed();
          return `Kept the first free slot: ${s.local.replace("T", " ")} local.`;
        }
    return "No free slot this week.";
  }
  if (after === "booking") {
    if (r.json?.id) state.booking = r.json;
    else if (r.json?.booking_status && state.booking)
      state.booking = { ...state.booking, status: r.json.booking_status };
    changed();
    return state.booking ? `Booking ${state.booking.id} is ${state.booking.status}.` : null;
  }
  if (after === "webhook") {
    state.webhook = { id: r.json.id };
    changed();
    return "Webhook added. Events from now on are delivered to it.";
  }
  if (after === "webhookGone") {
    state.webhook = null;
    changed();
  }
  return null;
}

async function run(panel) {
  const button = panel.querySelector("[data-run]");
  const again = panel.querySelector("[data-run-again]");
  const { spec } = panel._data;
  button.setAttribute("aria-busy", "true");
  button.disabled = true;
  try {
    // Every request but the one that makes a sandbox needs one; make it on first use.
    if (spec.after !== "sandbox") await ensureSandbox();
    const t = tokens();
    const used =
      JSON.stringify(spec)
        .match(/\{\{(\w+)\}\}/g)
        ?.map((m) => m.slice(2, -2)) ?? [];
    const missing = used.find((name) => t[name] === null);
    if (missing) {
      hint(panel, `Needs ${NEEDS[missing] ?? missing}.`);
      return;
    }
    const query = spec.query
      ? `?${new URLSearchParams(Object.entries(spec.query).map(([k, v]) => [k, fill(v, t, false)]))}`
      : "";
    const path = fill(spec.path, t, false) + query;
    const headers = Object.fromEntries(
      Object.entries(spec.headers ?? {}).map(([k, v]) => [k, fill(v, t, false)]),
    );
    const body =
      spec.body === undefined ? undefined : JSON.parse(fill(JSON.stringify(spec.body), t, false));
    let raw;
    if (spec.sign) {
      raw = JSON.stringify(body);
      const ts = String(Math.floor(Date.now() / 1000));
      headers["x-provider-signature"] =
        `t=${ts},v1=${await hmacHex(t.payment_secret, `${ts}.${raw}`)}`;
    }
    const r = await api(spec.method, path, {
      body: raw ? undefined : body,
      raw,
      headers,
      auth: spec.auth !== false,
    });
    const note = keep(spec.after, r);
    showResponse(panel, r);
    hint(panel, note ?? (r.status < 300 ? "Done." : (r.json?.detail ?? `HTTP ${r.status}`)));
    if (again) again.disabled = false;
    const step = panel.closest("[data-step]");
    if (step && r.status < 300) step.dataset.done = "true";
  } catch (e) {
    hint(panel, e instanceof Error ? e.message : String(e));
  } finally {
    button.removeAttribute("aria-busy");
    button.disabled = false;
  }
}

for (const panel of $$("[data-panel]")) {
  renderPanel(panel);
  panel.querySelector("[data-run]")?.addEventListener("click", () => run(panel));
  const again = panel.querySelector("[data-run-again]");
  if (again) {
    again.disabled = true;
    again.addEventListener("click", () => run(panel));
  }
  const tabs = [...panel.querySelectorAll('[role="tab"]')];
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => setLang(tab.dataset.lang));
    tab.addEventListener("keydown", (e) => {
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const next = tabs[(to + tabs.length) % tabs.length];
      setLang(next.dataset.lang);
      next.focus();
    });
  });
}

document.addEventListener("click", async (e) => {
  const btn = /** @type {HTMLElement} */ (e.target)?.closest?.("[data-copy]");
  if (!btn) return;
  const panel = /** @type {any} */ (btn.closest("[data-panel]"));
  const text = panel
    ? fill(panel._data.snippets[lang], tokens(), true)
    : (btn.closest(".code")?.querySelector("pre")?.textContent ?? "");
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Select and copy";
  }
  setTimeout(() => (btn.textContent = "Copy"), 1600);
});

/* ---------------------------------------------------------------- key chip */

function renderKey() {
  const sb = state.sandbox;
  for (const el of $$("[data-key]"))
    el.textContent = sb ? `${sb.api_key.slice(0, 12)}…${sb.api_key.slice(-4)}` : "none yet";
  for (const el of $$("[data-key-status]")) {
    if (!sb) continue;
    const left = Math.max(0, Date.parse(sb.expires_at) - Date.now());
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    el.innerHTML = `Sandbox <code>${esc(sb.tenant_id)}</code> · expires in ${h} h ${m} min · <button type="button" class="btn ghost sm" data-new-sandbox>New sandbox</button>`;
  }
}
document.addEventListener("click", async (e) => {
  if (!(/** @type {HTMLElement} */ (e.target)?.closest?.("[data-new-sandbox]"))) return;
  state.sandbox = null;
  try {
    await ensureSandbox();
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err));
  }
});
renderKey();

/* ---------------------------------------------------------------- the race */

const race = $("[data-race]");
if (race) {
  const button = race.querySelector("[data-race-run]");
  const lanes = [...race.querySelectorAll("[data-lane]")];
  button.addEventListener("click", async () => {
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    try {
      await ensureSandbox();
      const room = state.sandbox.resources[0];
      const from = addDays(new Date(), 1);
      const a = await api(
        "GET",
        `/v1/resources/${room.id}/availability?from=${ymd(from)}&to=${ymd(addDays(from, 13))}`,
      );
      const soon = Date.now() + 5 * 60_000;
      const slot = (a.json?.days ?? [])
        .flatMap((d) => d.slots)
        .find((s) => s.available > 0 && Date.parse(s.starts_at) > soon);
      if (!slot) {
        toast("Room A is booked solid for two weeks — start a new sandbox.");
        return;
      }
      const when = new Date(slot.starts_at);
      const fmt = (o) =>
        new Intl.DateTimeFormat("en-GB", { timeZone: room.timezone, ...o }).format(when);
      race.querySelector("[data-race-when]").innerHTML =
        `${fmt({ weekday: "short" }).toUpperCase()}<br>${fmt({ hour: "2-digit", minute: "2-digit", hour12: false })}`;
      race.querySelector("[data-race-detail]").textContent =
        `${fmt({ day: "numeric", month: "short" })} · 60 min · capacity 1`;
      const cap = race.querySelector("[data-race-cap]");
      cap.textContent = "1 place";
      cap.classList.remove("taken");
      race.dataset.mode = "live";
      race.dispatchEvent(new CustomEvent("race", { detail: "start" }));
      for (const lane of lanes) {
        lane.className = "lane waiting";
        lane.querySelector(".res").textContent = "…";
      }
      const results = await Promise.all(
        lanes.map(async (lane, i) => {
          const r = await api("POST", "/v1/bookings", {
            body: {
              resource_id: room.id,
              starts_at: slot.starts_at,
              ends_at: slot.ends_at,
              customer_name: `Client ${i + 1}`,
            },
          });
          const won = r.status === 201;
          lane.className = `lane ${won ? "ok" : "no"}`;
          lane.querySelector(".res").textContent =
            `${r.status} ${won ? "Created" : (r.json?.code ?? "")} · ${Math.round(r.server ?? r.ms)} ms`;
          return won;
        }),
      );
      const wins = results.filter(Boolean).length;
      cap.textContent =
        wins === 1 ? `taken by client ${results.indexOf(true) + 1}` : `${wins} winners`;
      cap.classList.toggle("taken", wins === 1);
      race.dispatchEvent(new CustomEvent("race", { detail: wins ? "won" : "lost" }));
      toast(
        wins === 1
          ? "Five requests, one booking. The other four were told the slot is full."
          : `${wins} of 5 won.`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      race.dispatchEvent(new CustomEvent("race", { detail: "done" }));
      button.removeAttribute("aria-busy");
      button.disabled = false;
    }
  });
}

/* ---------------------------------------------------------------- live latency */

const fmtMs = (v) => (v === null || v === undefined ? "—" : `${Math.round(v)}`);
const fmtCount = (n) =>
  n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/** The last day of server time, fetched once per page. */
export const statusData = fetch("/status.json")
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);

statusData.then((s) => {
  if (!s) return;
  const o = s.overall;
  for (const el of $$("[data-lat]")) {
    const [, field] = el.dataset.lat.split(".");
    if (field === "p95") el.textContent = `p95 ${fmtMs(o.p95)} ms`;
    else if (field === "count") el.textContent = fmtCount(o.count);
    else if (field.endsWith("-big"))
      el.innerHTML =
        o[field.slice(0, 3)] === null ? "—" : `${fmtMs(o[field.slice(0, 3)])}<small> ms</small>`;
    else if (field.endsWith("-ms"))
      el.textContent = o[field.slice(0, 3)] === null ? "—" : `${fmtMs(o[field.slice(0, 3)])} ms`;
  }
  $("[data-status-pill] .dot")?.classList.toggle("warn", (o.p95 ?? 0) > 500);
  const spark = $("[data-spark]");
  if (spark && s.hourly.length > 1) {
    const max = Math.max(...s.hourly.map((h) => h.count), 1);
    const pts = s.hourly
      .map((h, i) => `${(i / (s.hourly.length - 1)) * 240},${44 - (h.count / max) * 40}`)
      .join(" ");
    spark.innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  const byOp = new Map(s.operations.map((op) => [op.operation, op]));
  for (const el of $$("[data-op]")) {
    const op = byOp.get(el.dataset.op);
    el.innerHTML = op
      ? `<span>live server time</span><b>p50 ${fmtMs(op.p50)} ms · p95 ${fmtMs(op.p95)} ms</b><span>${fmtCount(op.count)} req · 24 h</span>`
      : "<span>live server time</span><b>no requests in 24 h</b>";
  }
});

/* ---------------------------------------------------------------- page furniture */

if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  $$(".reveal").forEach((el) => io.observe(el));
} else $$(".reveal").forEach((el) => el.classList.add("in"));
