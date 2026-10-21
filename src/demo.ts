/**
 * The playground: one page, no build, driving the same API a client would, with every call
 * it makes written to a log so a visitor can see the requests behind the screen.
 */
export const demoPage = (origin: string, apiKey: string) => /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slot — reservations API</title>
<style>
  :root { color-scheme: dark; --bg: #0f1117; --card: #161a24; --line: #262b3a; --ink: #e9ecf4; --mute: #8b93a8; --live: #f6c453; --ok: #5fd68a; --bad: #ff6b6b; --hold: #b58cff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display: flex; align-items: baseline; gap: 14px; padding: 18px 24px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0; font-size: 18px; letter-spacing: 3px; text-transform: uppercase; }
  header a { color: var(--mute); text-decoration: none; margin-left: auto; }
  header a:hover { color: var(--ink); }
  main { display: grid; grid-template-columns: 300px 1fr 360px; gap: 16px; padding: 16px 24px; }
  @media (max-width: 1100px) { main { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .card h2 { margin: 0 0 10px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--mute); }
  label { display: block; color: var(--mute); font-size: 12px; margin: 10px 0 4px; }
  input, select, button { font: inherit; }
  input, select { width: 100%; background: #0f1117; border: 1px solid var(--line); color: var(--ink); border-radius: 8px; padding: 8px 10px; }
  button { background: var(--live); color: #141729; border: 0; border-radius: 999px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
  button.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
  button:disabled { opacity: .5; cursor: default; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; }
  .grid { display: grid; grid-template-columns: 72px repeat(7, 1fr); gap: 4px; }
  .grid .day { font-size: 11px; color: var(--mute); text-align: center; padding: 4px 0; }
  .grid .time { font-size: 11px; color: var(--mute); text-align: right; padding-right: 6px; line-height: 28px; }
  .slot { height: 28px; border-radius: 6px; background: #1d2233; border: 1px solid transparent; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; color: var(--mute); }
  .slot.free { background: #16352a; color: var(--ok); }
  .slot.free:hover { border-color: var(--ok); }
  .slot.full { background: #3a1b22; color: var(--bad); cursor: not-allowed; }
  .slot.some { background: #3a2f16; color: var(--live); }
  .slot.closed { background: transparent; border: 1px dashed var(--line); cursor: default; }
  .row { display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--mute); }
  .pill.confirmed { color: var(--ok); border-color: #2d6b45; }
  .pill.held { color: var(--hold); border-color: #5b4a8c; }
  .pill.cancelled { color: var(--mute); }
  .log { max-height: 360px; overflow: auto; font-size: 12px; }
  .log div { padding: 4px 0; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 48px 1fr 36px 64px; gap: 8px; }
  .log .s2 { color: var(--ok); } .log .s4 { color: var(--bad); } .log .s5 { color: var(--bad); }
  .note { color: var(--mute); font-size: 12px; }
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 16px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.on { opacity: 1; }
</style>
</head>
<body>
<header>
  <h1>Slot</h1>
  <span class="note">reservations API · Workers + D1 · every call below is a real request</span>
  <a href="/docs">OpenAPI docs →</a>
</header>
<main>
  <section>
    <div class="card">
      <h2>Tenant</h2>
      <label>API key</label>
      <input id="key" class="mono" value="${apiKey}">
      <label>Resource</label>
      <select id="resource"></select>
      <p class="note" id="resourceNote"></p>
      <label>Week starting</label>
      <input id="from" type="date">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="ghost" id="prev">← Week</button>
        <button class="ghost" id="next">Week →</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Book a slot</h2>
      <p class="note" id="picked">Pick a free slot on the grid.</p>
      <label>Name</label>
      <input id="name" value="Deniz Aksoy">
      <label><input type="checkbox" id="hold" style="width:auto"> Hold for 10 minutes instead of confirming</label>
      <label>Idempotency-Key <span class="note">(send twice: same booking back)</span></label>
      <input id="idem" class="mono" placeholder="optional">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button id="book" disabled>Book</button>
        <button class="ghost" id="bookAgain" disabled>Send again</button>
      </div>
    </div>
  </section>

  <section>
    <div class="card">
      <h2>Availability <span class="note" id="tz"></span></h2>
      <div class="grid" id="grid"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Bookings</h2>
      <div id="bookings"></div>
    </div>
  </section>

  <section>
    <div class="card">
      <h2>Webhooks</h2>
      <p class="note">Point an endpoint at this page's sink and watch deliveries arrive, signed.</p>
      <div style="display:flex;gap:8px"><button id="addHook">Add endpoint → /demo/sink</button><button class="ghost" id="ping" disabled>Test</button></div>
      <div id="hooks" style="margin-top:8px"></div>
      <h2 style="margin-top:14px">Deliveries</h2>
      <div id="deliveries" class="log"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Payment provider</h2>
      <p class="note">Signs a payment event with the tenant's secret and posts it. Post it twice: the second is acknowledged and changes nothing.</p>
      <button id="pay" disabled>Pay for the last booking</button>
      <p class="note mono" id="payOut"></p>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Request log</h2>
      <div id="log" class="log"></div>
    </div>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>
const ORIGIN = ${JSON.stringify(origin)};
const PAYMENT_SECRET = "whsec_demo_2026";
const $ = (s) => document.querySelector(s);
const state = { resources: [], resource: null, from: null, picked: null, last: null, lastRequest: null, hooks: [] };

function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); setTimeout(() => el.classList.remove("on"), 2200); }

async function api(method, path, body, headers = {}) {
  const t0 = performance.now();
  const res = await fetch(ORIGIN + path, {
    method,
    headers: { authorization: "Bearer " + $("#key").value, "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Math.round(performance.now() - t0);
  const json = res.status === 204 ? null : await res.json();
  const row = document.createElement("div");
  row.innerHTML = '<span class="mono">' + method + '</span><span class="mono">' + path + '</span><span class="mono s' + String(res.status)[0] + '">' + res.status + (res.headers.get("idempotent-replayed") ? "↺" : "") + '</span><span class="mono note">' + ms + ' ms</span>';
  $("#log").prepend(row);
  return { status: res.status, json, replayed: res.headers.get("idempotent-replayed") === "true" };
}

const local = (iso) => new Date(iso).toLocaleString("en-GB", { timeZone: state.resource.timezone, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
function monday(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
const ymd = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

async function loadResources() {
  const r = await api("GET", "/v1/resources");
  if (r.status !== 200) { toast("Could not list resources: " + (r.json?.error?.message ?? r.status)); return; }
  state.resources = r.json;
  $("#resource").innerHTML = r.json.map((x) => '<option value="' + x.id + '">' + x.name + '</option>').join("");
  state.resource = r.json[0];
  await loadGrid();
}

async function loadGrid() {
  const r = state.resource; if (!r) return;
  $("#resourceNote").textContent = r.timezone + " · " + r.slot_minutes + "-minute slots · capacity " + r.capacity;
  $("#tz").textContent = "· local to " + r.timezone;
  const from = ymd(state.from), to = ymd(addDays(state.from, 6));
  const a = await api("GET", "/v1/resources/" + r.id + "/availability?from=" + from + "&to=" + to);
  if (a.status !== 200) { toast(a.json?.error?.message ?? "Availability failed"); return; }
  const times = [...new Set(a.json.days.flatMap((d) => d.slots.map((s) => s.local.slice(11))))].sort();
  const grid = $("#grid");
  grid.innerHTML = '<div></div>' + a.json.days.map((d) => '<div class="day">' + d.date.slice(5) + '</div>').join("");
  for (const t of times) {
    grid.insertAdjacentHTML("beforeend", '<div class="time mono">' + t + '</div>');
    for (const d of a.json.days) {
      const s = d.slots.find((x) => x.local.slice(11) === t);
      if (!s) { grid.insertAdjacentHTML("beforeend", '<div class="slot closed"></div>'); continue; }
      const cls = s.available === 0 ? "full" : s.available < r.capacity ? "some" : "free";
      const el = document.createElement("div");
      el.className = "slot " + cls; el.textContent = r.capacity > 1 ? s.available + "/" + r.capacity : (s.available ? "free" : "full");
      el.title = s.starts_at;
      if (s.available > 0) el.onclick = () => { state.picked = s; $("#picked").textContent = s.local.replace("T", " ") + " → " + s.ends_at; $("#book").disabled = false; };
      grid.appendChild(el);
    }
  }
  await loadBookings();
}

async function loadBookings() {
  const b = await api("GET", "/v1/bookings?resource_id=" + state.resource.id);
  if (b.status !== 200) return;
  $("#bookings").innerHTML = b.json.slice(0, 8).map((x) => '<div class="row"><span><span class="mono">' + local(x.starts_at) + '</span> · ' + (x.customer_name ?? "") + '</span><span style="display:flex;gap:6px;align-items:center"><span class="pill ' + x.status + '">' + x.status + '</span>' + (x.status === "held" ? '<button class="ghost" data-confirm="' + x.id + '">Confirm</button>' : "") + (x.status !== "cancelled" ? '<button class="ghost" data-cancel="' + x.id + '">Cancel</button>' : "") + '</span></div>').join("") || '<p class="note">No bookings yet.</p>';
  $("#bookings").querySelectorAll("[data-confirm]").forEach((el) => el.onclick = async () => { await api("POST", "/v1/bookings/" + el.dataset.confirm + "/confirm"); loadGrid(); });
  $("#bookings").querySelectorAll("[data-cancel]").forEach((el) => el.onclick = async () => { await api("POST", "/v1/bookings/" + el.dataset.cancel + "/cancel"); loadGrid(); });
}

async function book() {
  if (!state.picked) return;
  const body = { resource_id: state.resource.id, starts_at: state.picked.starts_at, ends_at: state.picked.ends_at, customer_name: $("#name").value, hold: $("#hold").checked };
  const headers = $("#idem").value ? { "idempotency-key": $("#idem").value } : {};
  state.lastRequest = { body, headers };
  const r = await api("POST", "/v1/bookings", body, headers);
  if (r.status === 201) { state.last = r.json; toast((r.json.status === "held" ? "Held " : "Booked ") + r.json.id + (r.replayed ? " (replayed)" : "")); $("#pay").disabled = false; $("#bookAgain").disabled = false; }
  else toast(r.json?.error?.message ?? ("HTTP " + r.status));
  loadGrid(); loadDeliveries();
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pay() {
  if (!state.last) return;
  const event = { provider_ref: "pay_" + state.last.id.slice(-6), booking_id: state.last.id, amount_minor: 12000, currency: "GBP", status: "succeeded" };
  const body = JSON.stringify(event);
  const t = String(Math.floor(Date.now() / 1000));
  const sig = "t=" + t + ",v1=" + (await hmac(PAYMENT_SECRET, t + "." + body));
  const res = await fetch(ORIGIN + "/v1/payments/webhook", { method: "POST", headers: { "content-type": "application/json", "x-provider-signature": sig }, body });
  const json = await res.json();
  const row = document.createElement("div");
  row.innerHTML = '<span class="mono">POST</span><span class="mono">/v1/payments/webhook</span><span class="mono s' + String(res.status)[0] + '">' + res.status + '</span><span class="mono note">signed</span>';
  $("#log").prepend(row);
  $("#payOut").textContent = JSON.stringify(json);
  loadGrid(); loadDeliveries();
}

async function loadHooks() {
  const r = await api("GET", "/v1/webhooks");
  if (r.status !== 200) return;
  state.hooks = r.json;
  $("#hooks").innerHTML = r.json.map((h) => '<div class="row"><span class="mono note" style="overflow:hidden;text-overflow:ellipsis">' + h.url.replace(ORIGIN, "") + '</span><button class="ghost" data-del="' + h.id + '">Remove</button></div>').join("");
  $("#hooks").querySelectorAll("[data-del]").forEach((el) => el.onclick = async () => { await api("DELETE", "/v1/webhooks/" + el.dataset.del); loadHooks(); });
  $("#ping").disabled = r.json.length === 0;
}

async function loadDeliveries() {
  const r = await api("GET", "/v1/webhooks/deliveries");
  if (r.status !== 200) return;
  $("#deliveries").innerHTML = r.json.slice(0, 12).map((d) => '<div><span class="mono ' + (d.delivered_at ? "s2" : "s5") + '">' + (d.last_status ?? "—") + '</span><span>' + d.event + '</span><span class="mono note">×' + d.attempts + '</span><span class="mono note">' + d.created_at.slice(11, 19) + '</span></div>').join("") || '<p class="note">Nothing delivered yet.</p>';
}

$("#resource").onchange = (e) => { state.resource = state.resources.find((r) => r.id === e.target.value); state.picked = null; $("#book").disabled = true; loadGrid(); };
$("#from").onchange = (e) => { state.from = monday(new Date(e.target.value + "T12:00:00Z")); $("#from").value = ymd(state.from); loadGrid(); };
$("#prev").onclick = () => { state.from = addDays(state.from, -7); $("#from").value = ymd(state.from); loadGrid(); };
$("#next").onclick = () => { state.from = addDays(state.from, 7); $("#from").value = ymd(state.from); loadGrid(); };
$("#book").onclick = book;
$("#bookAgain").onclick = async () => { if (!state.lastRequest) return; const r = await api("POST", "/v1/bookings", state.lastRequest.body, state.lastRequest.headers); toast(r.status + (r.replayed ? " — replayed, same booking" : r.status === 409 ? " — " + r.json.error.message : "")); loadGrid(); };
$("#addHook").onclick = async () => { await api("POST", "/v1/webhooks", { url: ORIGIN + "/demo/sink", events: ["*"] }); loadHooks(); };
$("#ping").onclick = async () => { const h = state.hooks[0]; if (h) { await api("POST", "/v1/webhooks/" + h.id + "/test"); setTimeout(loadDeliveries, 800); } };
$("#pay").onclick = pay;
$("#key").onchange = () => { loadResources(); loadHooks(); loadDeliveries(); };

state.from = monday(new Date());
$("#from").value = ymd(state.from);
loadResources(); loadHooks(); loadDeliveries();
setInterval(loadDeliveries, 15000);
</script>
</body>
</html>`;
