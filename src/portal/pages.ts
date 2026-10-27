import { PROBLEM_CODES, problemTitle } from "../problem";
import { SANDBOX_HOURS, SANDBOX_LIMITS } from "../sandbox";
import { ERROR_DOCS } from "./errors";
import { MARK, esc, inline } from "./html";
import { OPERATION_SPECS, codePanel } from "./snippets";

const ICONS = {
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`,
  repeat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m12 2 10 5-10 5L2 7l10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`,
};

const step = (title: string, text: string, notes: string[], panel: string, id: string) => `
<article class="step reveal" id="${id}" data-step>
  <div class="step-text">
    <h3>${esc(title)}</h3>
    <p>${text}</p>
    ${notes.length ? `<ul>${notes.map((n) => `<li>${n}</li>`).join("")}</ul>` : ""}
  </div>
  ${panel}
</article>`;

export function homeBody(origin: string) {
  const lanes = [0, 1, 2, 3, 4]
    .map(
      (i) => `<div class="lane ${i === 2 ? "ok" : "no"}" style="--i:${i}" data-lane="${i}">
        <span class="who">client ${i + 1}</span><span class="track"><i class="pkt"></i></span><span class="res">${i === 2 ? "201 Created" : "409 full"}</span>
      </div>`,
    )
    .join("");
  const S = OPERATION_SPECS;
  return `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <span class="eyebrow">Reservations API · Cloudflare Workers + D1</span>
      <h1 style="margin-top:14px">Bookings that <em>cannot</em> double&#8209;book.</h1>
      <p class="lede" style="margin-top:18px">Time zones without an offset table, holds that expire, retries that never book twice, signed webhooks that retry until they land — behind a REST API with an OpenAPI 3.1 contract. Take a key and make your first booking in five minutes.</p>
      <div class="ctas"><a class="btn primary" href="#quickstart">Start the quickstart</a><a class="btn ghost" href="/docs/reference">API reference</a></div>
      <div class="facts"><span>p95 <b data-lat="overall.p95-ms">—</b> server time, last 24 h</span><span>races tested at the database</span><span>RFC 9457 errors</span><span>cursor pagination</span></div>
    </div>
    <div class="race" data-race data-mode="idle" aria-labelledby="race-title">
      <div class="race-head"><b id="race-title">Five requests, one place</b><span class="m post">POST</span></div>
      <div class="race-slot">
        <span class="cal" data-race-when>THU<br>10:00</span>
        <div><div style="font-weight:600" data-race-room>Room A — recording</div><div class="muted small mono" data-race-detail>60-minute slot · capacity 1</div></div>
        <span class="cap" data-race-cap>1 place</span>
      </div>
      <div class="lanes" aria-live="polite">${lanes}</div>
      <div class="race-foot">
        <p>The capacity check runs inside the insert, as one statement, so exactly one request wins however close together they arrive. Race them for real on your sandbox.</p>
        <button class="btn primary sm" type="button" data-race-run><span class="spin" aria-hidden="true"></span>Race them for real</button>
      </div>
    </div>
  </div>
</section>

<section class="band" id="quickstart" aria-labelledby="qs-title">
  <div class="wrap">
    <div class="band-head">
      <span class="eyebrow">Quickstart · six requests</span>
      <h2 id="qs-title">Your first booking, in five minutes</h2>
      <p class="lede">Each step is a real request to this API. Run them in order — every one fills in the next one's values — or copy the code and run it from your own machine.</p>
      <div class="keychip" data-keychip><span>Your key</span><code data-key>none yet</code><span class="muted" data-key-status>Step 1 creates it.</span></div>
    </div>
    <div class="steps">
      ${step(
        "Get a sandbox key",
        `A sandbox is a tenant of your own for ${SANDBOX_HOURS} hours: three resources with weekly hours in two time zones, and a few bookings already on the calendar. Nobody else can see it, and it is deleted with everything in it when the day is up.`,
        [
          "The key is shown once; the database keeps only its SHA-256.",
          `Quotas keep it a toy: ${SANDBOX_LIMITS.resources} resources, ${SANDBOX_LIMITS.bookings} bookings, ${SANDBOX_LIMITS.webhooks} webhooks.`,
        ],
        codePanel(S["POST /v1/sandbox"], origin, { id: "qs-sandbox", label: "Create a sandbox" }),
        "step-key",
      )}
      ${step(
        "Find a free slot",
        "Ask for a week of Room A. Dates are local to the resource's zone, instants are UTC, and each slot says how many more bookings it can take. The first free one is kept for the next steps.",
        [
          "Opening hours are rules in local wall-clock time; the conversion uses <code>Intl</code> only, so clock changes need no table.",
          "Reads are served by the nearest D1 replica.",
        ],
        codePanel(S["GET /v1/resources/{id}/availability"], origin, {
          id: "qs-availability",
          label: "Availability",
        }),
        "step-slot",
      )}
      ${step(
        "Subscribe to events",
        "Point a webhook at the portal's test receiver. Every event from now on is delivered to it, signed, and retried at 1, 5, 30, 120 and 720 minutes if the receiver fails.",
        [
          "Try <code>https://169.254.169.254/</code> as the URL — addresses inside a network are refused.",
        ],
        codePanel(S["POST /v1/webhooks"], origin, { id: "qs-webhook", label: "Add a webhook" }),
        "step-webhook",
      )}
      ${step(
        "Hold the slot",
        "A hold takes the place for ten minutes while your customer pays. Then press <b>Send again</b>: the same <code>Idempotency-Key</code> returns the same booking, marked <code>Idempotent-Replayed</code>, instead of making a second one.",
        [
          "A different body under the same key is refused with <code>422</code>, not silently replayed.",
        ],
        codePanel(S["POST /v1/bookings"], origin, {
          id: "qs-hold",
          label: "Hold a slot",
          again: true,
        }),
        "step-hold",
      )}
      ${step(
        "Take the payment",
        "Your payment provider calls this hook when the card goes through. The body is signed with the tenant's payment secret, and the provider's reference is unique, so a replayed event is acknowledged and changes nothing.",
        ["Run it twice: the second answer says <code>applied: false</code>."],
        codePanel(S["POST /v1/payments/webhook"], origin, {
          id: "qs-pay",
          label: "Payment webhook",
          again: true,
        }),
        "step-pay",
      )}
      ${step(
        "See what was sent",
        "Every event the hold and the payment produced was delivered to your webhook. Each delivery is a row you can read: the event, the attempts, and the status your endpoint answered.",
        [
          "Deliveries carry <code>X-Slot-Signature: t=…,v1=…</code>; the guide shows how to verify it.",
        ],
        codePanel(S["GET /v1/webhooks/deliveries"], origin, {
          id: "qs-deliveries",
          label: "Deliveries",
        }),
        "step-deliveries",
      )}
    </div>
  </div>
</section>

<section class="band" aria-labelledby="live-title">
  <div class="wrap">
    <div class="band-head">
      <span class="eyebrow">Measured, not claimed</span>
      <h2 id="live-title">Server time on real requests, last 24 hours</h2>
      <p class="lede">Every API request is timed inside the Worker and counted into a histogram in D1. These numbers are read from it; the status page breaks them down by endpoint.</p>
    </div>
    <div class="latency">
      <div class="metric"><span class="k">p50</span><span class="v" data-lat="overall.p50-big">—</span><span class="n">half of requests are faster</span></div>
      <div class="metric"><span class="k">p95</span><span class="v" data-lat="overall.p95-big">—</span><span class="n">19 in 20 are faster</span></div>
      <div class="metric"><span class="k">p99</span><span class="v" data-lat="overall.p99-big">—</span><span class="n">the slow tail</span></div>
      <div class="metric"><span class="k">requests</span><span class="v" data-lat="overall.count">—</span><svg class="spark" data-spark viewBox="0 0 240 44" preserveAspectRatio="none" aria-hidden="true"></svg></div>
    </div>
    <p style="margin-top:16px"><a href="/status">Every endpoint on the status page →</a></p>
  </div>
</section>

<section class="band" aria-labelledby="features-title">
  <div class="wrap">
    <div class="band-head">
      <span class="eyebrow">What it handles</span>
      <h2 id="features-title">The parts of booking that go wrong in production</h2>
    </div>
    <div class="features">
      <div class="feature reveal"><span class="ico">${ICONS.clock}</span><h3>Time zones, crossed once</h3><p>Hours are rules in the resource's own zone; bookings are UTC instants. A slot that the clock change skips is never offered, and a 25-hour day has 25 hours.</p></div>
      <div class="feature reveal"><span class="ico">${ICONS.lock}</span><h3>Capacity in one statement</h3><p><code>INSERT … SELECT … WHERE count &lt; capacity</code>. Five requests for three places get three <code>201</code>s and two <code>409</code>s — tested by racing them at the database.</p></div>
      <div class="feature reveal"><span class="ico">${ICONS.repeat}</span><h3>Retries that never book twice</h3><p>The first request under an <code>Idempotency-Key</code> claims it before it runs; a retry gets the stored response, and one that arrives mid-flight gets a <code>409</code>, not a second booking.</p></div>
      <div class="feature reveal"><span class="ico">${ICONS.bell}</span><h3>Webhooks you can see</h3><p>HMAC-signed, retried on a widening schedule, every attempt recorded. URLs that point inside a network are refused at the door.</p></div>
      <div class="feature reveal"><span class="ico">${ICONS.alert}</span><h3>Errors a program can read</h3><p>RFC 9457 problem details with a stable <code>code</code>, a JSON Pointer per invalid field, and the request id that is also in the logs.</p></div>
      <div class="feature reveal"><span class="ico">${ICONS.layers}</span><h3>Fast where the user is</h3><p>Reads go to the nearest D1 replica and come back with a bookmark, so a client always reads its own writes. Related reads travel in one batch.</p></div>
    </div>
  </div>
</section>`;
}

export const homeDescription =
  "Slot is a reservations API on Cloudflare Workers and D1: time zones, expiring holds, idempotent retries, signed webhooks, RFC 9457 errors. Get a sandbox key and book in five minutes.";

const codeBlock = (lang: string, code: string, label: string) =>
  `<div class="code"><div class="code-bar"><span class="mono small" style="color:var(--code-mute);padding:9px 0 11px">${esc(label)}</span><span class="sp"></span><button type="button" class="copy" data-copy>Copy</button></div><pre tabindex="0" aria-label="${esc(label)}" data-highlight="${lang}"><code>${esc(code)}</code></pre></div>`;

export function guidesBody(origin: string) {
  const sections = [
    ["sandboxes", "Sandboxes and keys"],
    ["idempotency", "Retrying safely"],
    ["webhooks", "Verifying webhooks"],
    ["time-zones", "Time zones"],
    ["pagination", "Pagination"],
    ["limits", "Limits and quotas"],
    ["consistency", "Reading your own writes"],
    ["capacity", "Why a slot cannot be oversold"],
  ];
  return `<div class="wrap docs">
  <aside class="side" aria-label="Guides"><details open><summary>Guides</summary><div class="side-groups"><div><h4>How to</h4>${sections
    .map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`)
    .join("")}</div></div></details></aside>
  <article class="doc prose">
    <div class="doc-head"><span class="eyebrow">Guides</span><h1 style="font-size:clamp(2rem,4vw,2.8rem)">Using Slot well</h1><p class="lede">The behaviours that matter once real customers are booking: retries, signatures, clocks, pages, limits.</p></div>

    <section><h2 id="sandboxes">Sandboxes and keys</h2>
    <p><code>POST /v1/sandbox</code> needs no key and returns one: <code>sk_test_…</code>, scoped to a tenant that exists for ${SANDBOX_HOURS} hours and is seeded with a small studio's calendar. Send it on every request as <code>Authorization: Bearer sk_test_…</code>. The database stores only its SHA-256, so a lost key cannot be recovered — make a new sandbox.</p>
    <p>A sandbox holds at most ${SANDBOX_LIMITS.resources} resources, ${SANDBOX_LIMITS.bookings} bookings, ${SANDBOX_LIMITS.webhooks} webhook endpoints and ${SANDBOX_LIMITS.deliveries} deliveries. Past a limit the API answers <code>403</code> with <code>code: "quota_exceeded"</code>.</p></section>

    <section><h2 id="idempotency">Retrying safely</h2>
    <p>Networks drop responses, not just requests. If a <code>POST /v1/bookings</code> times out, you cannot know whether the booking was made. Send a unique <code>Idempotency-Key</code> with every write and retry with the same key:</p>
    <ul><li>The first request claims the key <em>before</em> it runs, and its response is stored under it for a day.</li><li>A retry with the same key and body gets that response back — same status, same booking id — with <code>Idempotent-Replayed: true</code>.</li><li>A retry that arrives while the first is still running gets <code>409 idempotency_in_progress</code>. Wait and retry.</li><li>The same key with a different body is <code>422 idempotency_mismatch</code>: that is a bug in the client, not a retry.</li></ul>
    ${codeBlock(
      "js",
      `const key = crypto.randomUUID(); // one per booking attempt, kept across retries
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    const res = await fetch("${origin}/v1/bookings", {
      method: "POST",
      headers: { Authorization: "Bearer " + SLOT_KEY, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(booking),
    });
    if (res.status !== 409 || (await res.clone().json()).code !== "idempotency_in_progress") return res;
  } catch {
    // network error: fall through and retry with the same key
  }
  await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
}`,
      "Retrying a booking (JavaScript)",
    )}</section>

    <section><h2 id="webhooks">Verifying webhooks</h2>
    <p>Each delivery is a <code>POST</code> with the event as JSON and three headers: <code>X-Slot-Event</code>, <code>X-Slot-Delivery</code> (unique per delivery — use it to ignore duplicates) and <code>X-Slot-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>. The signature is HMAC-SHA256 over <code>t + "." + raw body</code> with the endpoint's secret, which <code>POST /v1/webhooks</code> returned once. Verify against the raw bytes, compare in constant time, and reject timestamps older than five minutes.</p>
    ${codeBlock(
      "js",
      `import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret, header, rawBody, now = Date.now() / 1000) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1 || Math.abs(now - Number(parts.t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(parts.t + "." + rawBody).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}`,
      "Verify a delivery (Node.js)",
    )}
    ${codeBlock(
      "python",
      `import hashlib, hmac, time

def verify(secret: str, header: str, raw_body: bytes) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts.get("t", 0))) > 300:
        return False
    signed = parts["t"].encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))`,
      "Verify a delivery (Python)",
    )}
    <p>Answer <code>2xx</code> quickly and do the work afterwards. Anything else is retried at 1, 5, 30, 120 and 720 minutes; every attempt is listed by <code>GET /v1/webhooks/deliveries</code>. Webhook URLs must be HTTPS on port 443 to a public host name: IP addresses in any spelling, single-label hosts and names like <code>.internal</code> or <code>.local</code> are refused.</p></section>

    <section><h2 id="time-zones">Time zones</h2>
    <p>A resource has an IANA zone, and its weekly rules are wall-clock minutes in that zone — <code>540</code> is 09:00 there, whatever the date. Availability takes local dates and returns each slot twice: <code>starts_at</code> as a UTC instant to book with, and <code>local</code> to show. On the day the clocks go forward, a 01:30 slot that does not exist is not offered; on the day they go back, the repeated hour is offered once per real instant.</p>
    <div class="callout">Book with the <code>starts_at</code> and <code>ends_at</code> exactly as availability returned them. Building an instant from a local time on the client is where off-by-an-hour bugs come from.</div></section>

    <section><h2 id="pagination">Pagination</h2>
    <p>Lists return <code>{ "data": [...], "next_cursor": "…" }</code>. Pass <code>next_cursor</code> as <code>cursor</code> to get the next page; it is <code>null</code> on the last. Cursors point after the last item rather than at an offset, so rows added while you page are neither skipped nor repeated. <code>limit</code> is 1–100, default 20.</p>
    ${codeBlock(
      "python",
      `import requests

def all_bookings(key: str):
    cursor = None
    while True:
        params = {"limit": 100, **({"cursor": cursor} if cursor else {})}
        page = requests.get("${origin}/v1/bookings", params=params,
                            headers={"Authorization": f"Bearer {key}"}).json()
        yield from page["data"]
        cursor = page["next_cursor"]
        if cursor is None:
            return`,
      "Every booking, page by page (Python)",
    )}</section>

    <section><h2 id="limits">Limits and quotas</h2>
    <ul><li><strong>60 requests a minute per key</strong>, enforced by the Workers rate-limiting binding. Over it: <code>429</code> with <code>Retry-After</code>.</li><li><strong>10 new sandboxes a minute per address</strong>, and at most 2,000 alive at once.</li><li>Availability: at most 31 days per request. Rules: at most 50 per resource.</li></ul></section>

    <section><h2 id="consistency">Reading your own writes</h2>
    <p>Reads are served by the D1 replica nearest the request, which can trail the primary by a moment. Every response carries <code>X-D1-Bookmark</code>; send it back on your next request and that request reads from a replica at least as fresh as your last write. The portal does this for you; a server-side client should keep the latest bookmark per user session.</p></section>

    <section><h2 id="capacity">Why a slot cannot be oversold</h2>
    <p>Checking availability and then inserting is two steps, and two requests can both pass the check before either inserts. Slot never does that. A booking is one statement that counts the live bookings overlapping the slot and inserts only if the count is under capacity; SQLite runs it atomically, so the second request sees the first one's row. Holds count until they expire; an expired hold is read as cancelled the moment it expires, whatever the cron has reached.</p>
    <p>The same shape protects idempotency keys: claiming a key is one upsert, so two retries cannot both run. Both are tested by starting five calls at once against the database, and both tests fail against a check-then-write version.</p></section>
  </article>
</div>`;
}

export function errorsBody(origin: string) {
  const rows = PROBLEM_CODES.map((code) => {
    const d = ERROR_DOCS[code];
    return `<tr id="${code}"><td><code>${code}</code></td><td class="num">${d.status}</td><td><strong>${esc(problemTitle(code))}</strong><br><span class="muted">${inline(d.when)}</span></td><td>${inline(d.fix)}</td></tr>`;
  }).join("");
  const example = JSON.stringify(
    {
      type: `${origin}/docs/errors#full`,
      title: "No capacity left",
      status: 409,
      detail: "That slot has no capacity left.",
      instance: "/v1/bookings",
      code: "full",
      request_id: "req_3f9a1c2e7b0d4a5e",
    },
    null,
    2,
  );
  return `<div class="wrap" style="padding:32px 0 80px;display:grid;gap:28px">
  <div class="doc-head"><span class="eyebrow">Reference · RFC 9457</span><h1 style="font-size:clamp(2rem,4vw,2.8rem)">Errors</h1>
  <p class="lede">Every error is an <code>application/problem+json</code> body. Branch on <code>code</code> — it never changes — and show <code>detail</code> to people. <code>type</code> links to the row below; <code>request_id</code> is the same id as the <code>X-Request-Id</code> header and the log line.</p></div>
  ${codeBlock("json", example, "409 Conflict · application/problem+json")}
  <div class="table-wrap" tabindex="0" role="region" aria-label="Error codes"><table><thead><tr><th scope="col">code</th><th scope="col" class="num">status</th><th scope="col">meaning</th><th scope="col">what to do</th></tr></thead><tbody>${rows}</tbody></table></div>
</div>`;
}

export function statusBody() {
  return `<div class="wrap" style="padding:32px 0 80px;display:grid;gap:28px">
  <div class="doc-head"><span class="eyebrow">Status</span><h1 style="font-size:clamp(2rem,4vw,2.8rem)"><span class="dot" aria-hidden="true" style="display:inline-block;width:12px;height:12px;margin-right:12px;vertical-align:middle"></span><span data-status-headline>Checking…</span></h1>
  <p class="lede">Server time is measured inside the Worker on every API request and kept as a histogram per endpoint in five-minute windows. It is the time the API spends — mostly waiting on the database — and leaves out the network between you and the edge, which is measured separately below.</p></div>
  <div class="latency">
    <div class="metric"><span class="k">p50 · 24 h</span><span class="v" data-lat="overall.p50-big">—</span></div>
    <div class="metric"><span class="k">p95 · 24 h</span><span class="v" data-lat="overall.p95-big">—</span></div>
    <div class="metric"><span class="k">p99 · 24 h</span><span class="v" data-lat="overall.p99-big">—</span></div>
    <div class="metric"><span class="k">requests · 24 h</span><span class="v" data-lat="overall.count">—</span></div>
    <div class="metric"><span class="k">you → edge</span><span class="v" data-rtt>—</span><span class="n" data-colo>round trip, median of 5</span></div>
  </div>
  <div class="chart"><h2 class="small eyebrow" style="margin-bottom:12px">Hour by hour</h2><svg data-hourly viewBox="0 0 960 200" preserveAspectRatio="none" role="img" aria-label="Server time per hour, p50 and p95"></svg>
  <div class="legend"><span><i style="background:var(--accent)"></i>p95</span><span><i style="background:var(--info)"></i>p50</span><span class="muted" data-hourly-note></span></div></div>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Server time per endpoint"><table><thead><tr><th scope="col">endpoint</th><th scope="col" class="num">requests</th><th scope="col" class="num">p50</th><th scope="col" class="num">p95</th><th scope="col" class="num">p99</th><th scope="col">p95, relative</th></tr></thead><tbody data-ops><tr><td colspan="6" class="muted">Loading…</td></tr></tbody></table></div>
  <p class="muted small">Raw numbers: <a href="/status.json">/status.json</a>. Percentiles are interpolated inside histogram buckets (2, 5, 10 … 2000 ms), which is exact to within a bucket.</p>
</div>`;
}

export function playgroundBody() {
  return `<div class="wrap">
  <div class="doc-head" style="padding-top:28px"><span class="eyebrow">Playground</span><h1 style="font-size:clamp(1.8rem,3.4vw,2.4rem)">A week of bookings, on your sandbox</h1><p class="lede">Every click below is a request to the API; the log on the right shows each one with its status and time.</p></div>
  <div class="pg">
    <section style="display:grid;gap:16px;align-content:start">
      <div class="card">
        <h2>Calendar</h2>
        <div class="field-row"><label for="pg-resource">Resource</label><select id="pg-resource"></select></div>
        <p class="muted small" id="pg-resource-note"></p>
        <div class="field-row"><label for="pg-from">Week starting</label><input id="pg-from" type="date"></div>
        <div style="display:flex;gap:8px"><button class="btn ghost sm" type="button" id="pg-prev">← Week</button><button class="btn ghost sm" type="button" id="pg-next">Week →</button></div>
      </div>
      <div class="card">
        <h2>Book</h2>
        <p class="muted small" id="pg-picked" aria-live="polite">Pick a free slot on the grid.</p>
        <div class="field-row"><label for="pg-name">Customer name</label><input id="pg-name" type="text" value="Deniz Aksoy" autocomplete="off"></div>
        <label class="check"><input type="checkbox" id="pg-hold"> Hold for ten minutes instead of confirming</label>
        <div class="field-row"><label for="pg-idem">Idempotency-Key <span class="muted">(optional; send twice for the same booking)</span></label><input id="pg-idem" type="text" class="mono" autocomplete="off" placeholder="any string"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" type="button" id="pg-book" disabled>Book</button><button class="btn ghost sm" type="button" id="pg-again" disabled>Send again</button></div>
      </div>
    </section>
    <section style="display:grid;gap:16px;align-content:start;min-width:0">
      <div class="card"><h2>Availability <span class="muted" id="pg-tz" style="text-transform:none;letter-spacing:0"></span></h2><div class="week" id="pg-week" role="group" aria-label="Slots this week"></div></div>
      <div class="card"><h2>Bookings</h2><div class="rows" id="pg-bookings"></div></div>
    </section>
    <section style="display:grid;gap:16px;align-content:start;min-width:0">
      <div class="card"><h2>Webhooks</h2><p class="muted small">Point an endpoint at the portal's test receiver and watch signed deliveries arrive.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" type="button" id="pg-hook">Add endpoint</button><button class="btn ghost sm" type="button" id="pg-ping" disabled>Send test</button></div><div class="rows" id="pg-hooks"></div><h2 style="margin-top:6px">Deliveries</h2><div class="log" id="pg-deliveries"></div></div>
      <div class="card"><h2>Payment provider</h2><p class="muted small">Signs a payment event with your sandbox's payment secret. Post it twice: the second is acknowledged and changes nothing.</p><button class="btn primary sm" type="button" id="pg-pay" disabled>Pay for the last booking</button><p class="mono small muted" id="pg-pay-out" aria-live="polite"></p></div>
      <div class="card"><h2>Request log</h2><div class="log" id="pg-log" aria-live="off"></div></div>
    </section>
  </div>
</div>`;
}

export const notFoundPage = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · Slot</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0b0e;color:#eceef3;font:16px/1.6 ui-sans-serif,system-ui,sans-serif}main{display:grid;gap:14px;justify-items:center;text-align:center;padding:24px}svg{width:56px;height:56px}a{color:#f6c453}p{color:#b7bcc9;margin:0}h1{margin:0;font-size:2rem;letter-spacing:-.02em}</style></head><body><main>${MARK}<h1>That slot is empty.</h1><p>Nothing lives at this address.</p><p><a href="/">Back to the quickstart</a> · <a href="/docs/reference">API reference</a></p></main></body></html>`;
