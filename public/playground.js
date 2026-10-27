// @ts-check
/** The playground: a week calendar over the visitor's sandbox, with every request in a log. */
import { addDays, api, ensureSandbox, hmacHex, state, toast, ymd } from "/portal.js";

/** @returns {any} */
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");

const pg = {
  resource:
    /** @type {{ id: string, name: string, timezone: string, slot_minutes: number, capacity: number } | null} */ (
      null
    ),
  resources: /** @type {any[]} */ ([]),
  from: monday(new Date()),
  picked: /** @type {{ starts_at: string, ends_at: string, local: string } | null} */ (null),
  last: /** @type {any} */ (null),
  lastRequest: /** @type {any} */ (null),
  hooks: /** @type {any[]} */ ([]),
};

function monday(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return addDays(x, -((x.getUTCDay() + 6) % 7));
}

document.addEventListener("slot:request", (e) => {
  const r = /** @type {CustomEvent} */ (e).detail;
  const row = document.createElement("div");
  row.innerHTML = `<span>${esc(r.method)}</span><span title="${esc(r.path)}">${esc(r.path)}</span><span class="s${String(r.status)[0]}">${r.status}${r.replayed ? "↺" : ""}</span><span class="muted" title="total · server">${Math.round(r.ms)}${r.server !== null ? `·${Math.round(r.server)}` : ""} ms</span>`;
  $("#pg-log").prepend(row);
});

const local = (iso) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: pg.resource?.timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

async function loadResources() {
  const r = await api("GET", "/v1/resources?limit=20");
  if (r.status !== 200) return toast(r.json?.detail ?? `Could not list resources (${r.status})`);
  pg.resources = r.json.data;
  $("#pg-resource").innerHTML = pg.resources
    .map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`)
    .join("");
  pg.resource = pg.resources[0] ?? null;
  await loadWeek();
}

async function loadWeek() {
  const r = pg.resource;
  if (!r) return;
  $("#pg-resource-note").textContent =
    `${r.timezone} · ${r.slot_minutes}-minute slots · capacity ${r.capacity}`;
  $("#pg-tz").textContent = `· local to ${r.timezone}`;
  $("#pg-from").value = ymd(pg.from);
  const a = await api(
    "GET",
    `/v1/resources/${r.id}/availability?from=${ymd(pg.from)}&to=${ymd(addDays(pg.from, 6))}`,
  );
  if (a.status !== 200) return toast(a.json?.detail ?? "Availability failed");
  const days = a.json.days;
  const times = [...new Set(days.flatMap((d) => d.slots.map((s) => s.local.slice(11))))].sort();
  const grid = $("#pg-week");
  const head = `<div></div>${days.map((d) => `<div class="d">${new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" })}</div>`).join("")}`;
  const rows = times
    .map((t) => {
      const cells = days
        .map((d) => {
          const s = d.slots.find((x) => x.local.slice(11) === t);
          if (!s) return '<div class="slot closed" aria-hidden="true"></div>';
          const past = Date.parse(s.starts_at) < Date.now();
          const cls = past
            ? "past"
            : s.available === 0
              ? "full"
              : s.available < r.capacity
                ? "some"
                : "free";
          const label =
            r.capacity > 1
              ? `${s.available}/${r.capacity}`
              : s.available && !past
                ? "free"
                : past
                  ? "past"
                  : "full";
          const picked = pg.picked?.starts_at === s.starts_at;
          return cls === "full" || cls === "past"
            ? `<div class="slot ${cls}">${label}</div>`
            : `<button type="button" class="slot ${cls}" aria-pressed="${picked}" aria-label="${esc(`${d.date} ${t}, ${label}`)}" data-start="${s.starts_at}" data-end="${s.ends_at}" data-local="${s.local}">${label}</button>`;
        })
        .join("");
      return `<div class="t">${t}</div>${cells}`;
    })
    .join("");
  grid.innerHTML = head + rows;
  await loadBookings();
}

$("#pg-week").addEventListener("click", (e) => {
  const cell = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (e.target).closest("button.slot")
  );
  if (!cell) return;
  pg.picked = {
    starts_at: cell.dataset.start,
    ends_at: cell.dataset.end,
    local: cell.dataset.local,
  };
  document
    .querySelectorAll("#pg-week button.slot")
    .forEach((b) => b.setAttribute("aria-pressed", String(b === cell)));
  $("#pg-picked").textContent =
    `${pg.picked.local.replace("T", " ")} local → ${pg.picked.starts_at} UTC`;
  $("#pg-book").disabled = false;
});

async function loadBookings() {
  const b = await api("GET", `/v1/bookings?resource_id=${pg.resource?.id}&limit=8`);
  if (b.status !== 200) return;
  $("#pg-bookings").innerHTML =
    b.json.data
      .map(
        (x) =>
          `<div class="rowi"><span><span class="mono">${esc(local(x.starts_at))}</span> · ${esc(x.customer_name)}</span><span style="display:flex;gap:6px;align-items:center"><span class="pill ${x.status}">${x.status}</span>${x.status === "held" ? `<button type="button" class="btn ghost sm" data-confirm="${x.id}">Confirm</button>` : ""}${x.status !== "cancelled" ? `<button type="button" class="btn ghost sm" data-cancel="${x.id}" aria-label="Cancel booking for ${esc(x.customer_name)}">Cancel</button>` : ""}</span></div>`,
      )
      .join("") || '<p class="muted small">No bookings yet.</p>';
}

$("#pg-bookings").addEventListener("click", async (e) => {
  const el = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (e.target).closest("[data-confirm], [data-cancel]")
  );
  if (!el) return;
  const id = el.dataset.confirm ?? el.dataset.cancel;
  await api("POST", `/v1/bookings/${id}/${el.dataset.confirm ? "confirm" : "cancel"}`);
  await loadWeek();
  setTimeout(loadDeliveries, 600);
});

async function book(again = false) {
  if (!again) {
    if (!pg.picked || !pg.resource) return;
    pg.lastRequest = {
      body: {
        resource_id: pg.resource.id,
        starts_at: pg.picked.starts_at,
        ends_at: pg.picked.ends_at,
        customer_name: $("#pg-name").value || "Guest",
        hold: $("#pg-hold").checked,
      },
      headers: $("#pg-idem").value ? { "idempotency-key": $("#pg-idem").value } : {},
    };
  }
  if (!pg.lastRequest) return;
  const r = await api("POST", "/v1/bookings", pg.lastRequest);
  if (r.status === 201) {
    pg.last = r.json;
    state.booking = r.json;
    toast(
      `${r.json.status === "held" ? "Held" : "Booked"} ${r.json.id}${r.replayed ? " — replayed, same booking" : ""}`,
    );
    $("#pg-pay").disabled = false;
    $("#pg-again").disabled = false;
  } else toast(r.json?.detail ?? `HTTP ${r.status}`);
  pg.picked = null;
  $("#pg-book").disabled = true;
  await loadWeek();
  setTimeout(loadDeliveries, 600);
}

async function pay() {
  if (!pg.last || !state.sandbox) return;
  const raw = JSON.stringify({
    provider_ref: `pay_${pg.last.id.slice(-8)}`,
    booking_id: pg.last.id,
    amount_minor: 12000,
    currency: "GBP",
    status: "succeeded",
  });
  const t = String(Math.floor(Date.now() / 1000));
  const sig = `t=${t},v1=${await hmacHex(state.sandbox.payment_secret, `${t}.${raw}`)}`;
  const r = await api("POST", "/v1/payments/webhook", {
    raw,
    headers: { "x-provider-signature": sig },
    auth: false,
  });
  $("#pg-pay-out").textContent = JSON.stringify(r.json);
  await loadWeek();
  setTimeout(loadDeliveries, 600);
}

async function loadHooks() {
  const r = await api("GET", "/v1/webhooks");
  if (r.status !== 200) return;
  pg.hooks = r.json.data;
  $("#pg-hooks").innerHTML = pg.hooks
    .map(
      (h) =>
        `<div class="rowi"><span class="mono small muted" style="overflow:hidden;text-overflow:ellipsis">${esc(h.url.replace(location.origin, ""))}</span><button type="button" class="btn ghost sm" data-del="${h.id}">Remove</button></div>`,
    )
    .join("");
  $("#pg-ping").disabled = pg.hooks.length === 0;
}

$("#pg-hooks").addEventListener("click", async (e) => {
  const el = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (e.target).closest("[data-del]")
  );
  if (!el) return;
  await api("DELETE", `/v1/webhooks/${el.dataset.del}`);
  await loadHooks();
});

async function loadDeliveries() {
  const r = await api("GET", "/v1/webhooks/deliveries?limit=12");
  if (r.status !== 200) return;
  $("#pg-deliveries").innerHTML =
    r.json.data
      .map(
        (d) =>
          `<div><span class="${d.delivered_at ? "s2" : "s5"}">${d.last_status ?? "—"}</span><span>${esc(d.event)}</span><span class="muted">×${d.attempts}</span><span class="muted">${d.created_at.slice(11, 19)}</span></div>`,
      )
      .join("") || '<p class="muted small">Nothing delivered yet.</p>';
}

$("#pg-resource").addEventListener("change", (e) => {
  pg.resource =
    pg.resources.find((r) => r.id === /** @type {HTMLSelectElement} */ (e.target).value) ?? null;
  pg.picked = null;
  $("#pg-book").disabled = true;
  loadWeek();
});
$("#pg-from").addEventListener("change", (e) => {
  const v = /** @type {HTMLInputElement} */ (e.target).value;
  if (v) pg.from = monday(new Date(`${v}T12:00:00Z`));
  loadWeek();
});
$("#pg-prev").addEventListener("click", () => ((pg.from = addDays(pg.from, -7)), loadWeek()));
$("#pg-next").addEventListener("click", () => ((pg.from = addDays(pg.from, 7)), loadWeek()));
$("#pg-book").addEventListener("click", () => book());
$("#pg-again").addEventListener("click", () => book(true));
$("#pg-hook").addEventListener("click", async () => {
  const r = await api("POST", "/v1/webhooks", {
    body: { url: `${location.origin}/demo/sink`, events: ["*"] },
  });
  if (r.status !== 201) toast(r.json?.detail ?? `HTTP ${r.status}`);
  await loadHooks();
});
$("#pg-ping").addEventListener("click", async () => {
  const h = pg.hooks[0];
  if (!h) return;
  await api("POST", `/v1/webhooks/${h.id}/test`);
  setTimeout(loadDeliveries, 800);
});
$("#pg-pay").addEventListener("click", pay);

async function start() {
  try {
    await ensureSandbox();
  } catch (e) {
    return toast(e instanceof Error ? e.message : String(e));
  }
  await Promise.all([loadResources(), loadHooks(), loadDeliveries()]);
}
document.addEventListener("slot:state", () => {
  if (!state.sandbox) return;
  if (!pg.resources.some((r) => state.sandbox?.resources.some((s) => s.id === r.id))) start();
});
start();
setInterval(() => !document.hidden && loadDeliveries(), 15_000);
