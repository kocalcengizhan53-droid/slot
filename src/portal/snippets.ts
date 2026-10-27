/**
 * Requests, described once. The same description renders the curl, JavaScript and Python
 * samples on a page and drives the Run button beside them, so the code a visitor reads is
 * the request that runs. Values written `{{like_this}}` are filled in the browser from the
 * visitor's sandbox: their key, the resource they picked, the slot they found.
 */

export type Spec = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  /** False for the two open doors: the sandbox and the payment provider's hook. */
  auth?: boolean;
  /** Sign the body as the payment provider would. */
  sign?: boolean;
  /** What the browser keeps from the response: a sandbox, a slot, a booking, a webhook. */
  after?: "sandbox" | "slot" | "booking" | "webhook" | "webhookGone";
};

const qs = (q?: Record<string, string>) =>
  q && Object.keys(q).length
    ? `?${Object.entries(q)
        .map(([k, v]) => `${k}=${v}`)
        .join("&")}`
    : "";

const pyLiteral = (value: unknown, indent = 4): string =>
  JSON.stringify(value, null, indent)
    .replace(/: true\b/g, ": True")
    .replace(/: false\b/g, ": False")
    .replace(/: null\b/g, ": None");

function curl(spec: Spec, origin: string) {
  const url = `${origin}${spec.path}${qs(spec.query)}`;
  const body = spec.body === undefined ? null : JSON.stringify(spec.body, null, 2);
  if (spec.sign) {
    return [
      `BODY='${JSON.stringify(spec.body)}'`,
      "T=$(date +%s)",
      `SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "{{payment_secret}}" -hex | sed 's/^.* //')`,
      "",
      `curl -X POST "${url}" \\`,
      '  -H "Content-Type: application/json" \\',
      '  -H "X-Provider-Signature: t=$T,v1=$SIG" \\',
      '  -d "$BODY"',
    ].join("\n");
  }
  const lines = [spec.method === "GET" ? `curl "${url}"` : `curl -X ${spec.method} "${url}"`];
  if (spec.auth !== false) lines.push('  -H "Authorization: Bearer {{key}}"');
  if (body) lines.push('  -H "Content-Type: application/json"');
  for (const [k, v] of Object.entries(spec.headers ?? {})) lines.push(`  -H "${k}: ${v}"`);
  if (body) lines.push(`  -d '${body.replace(/\n/g, "\n  ")}'`);
  return lines.join(" \\\n");
}

function js(spec: Spec, origin: string) {
  const url = `${origin}${spec.path}${qs(spec.query)}`;
  if (spec.sign) {
    return [
      `const body = JSON.stringify(${JSON.stringify(spec.body, null, 2)});`,
      "const t = Math.floor(Date.now() / 1000);",
      'const secret = new TextEncoder().encode("{{payment_secret}}");',
      'const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);',
      'const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + body));',
      'const v1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");',
      "",
      `const res = await fetch("${url}", {`,
      '  method: "POST",',
      '  headers: { "Content-Type": "application/json", "X-Provider-Signature": "t=" + t + ",v1=" + v1 },',
      "  body,",
      "});",
      "console.log(res.status, await res.json());",
    ].join("\n");
  }
  const headers: string[] = [];
  if (spec.auth !== false) headers.push('Authorization: "Bearer {{key}}"');
  if (spec.body !== undefined) headers.push('"Content-Type": "application/json"');
  for (const [k, v] of Object.entries(spec.headers ?? {})) headers.push(`"${k}": "${v}"`);
  const opts: string[] = [];
  if (spec.method !== "GET") opts.push(`  method: "${spec.method}",`);
  if (headers.length)
    opts.push(`  headers: {\n${headers.map((h) => `    ${h},`).join("\n")}\n  },`);
  if (spec.body !== undefined)
    opts.push(
      `  body: JSON.stringify(${JSON.stringify(spec.body, null, 2).replace(/\n/g, "\n  ")}),`,
    );
  return [
    opts.length
      ? `const res = await fetch("${url}", {\n${opts.join("\n")}\n});`
      : `const res = await fetch("${url}");`,
    spec.method === "DELETE"
      ? "console.log(res.status);"
      : "console.log(res.status, await res.json());",
  ].join("\n");
}

function python(spec: Spec, origin: string) {
  const url = `${origin}${spec.path}`;
  if (spec.sign) {
    return [
      "import hashlib, hmac, json, time",
      "import requests",
      "",
      `body = json.dumps(${pyLiteral(spec.body)}, separators=(",", ":"))`,
      "t = str(int(time.time()))",
      'v1 = hmac.new(b"{{payment_secret}}", f"{t}.{body}".encode(), hashlib.sha256).hexdigest()',
      "",
      "res = requests.post(",
      `    "${url}",`,
      "    data=body,",
      '    headers={"Content-Type": "application/json", "X-Provider-Signature": f"t={t},v1={v1}"},',
      ")",
      "print(res.status_code, res.json())",
    ].join("\n");
  }
  const args = [`    "${url}",`];
  const headers: string[] = [];
  if (spec.auth !== false) headers.push('"Authorization": "Bearer {{key}}"');
  for (const [k, v] of Object.entries(spec.headers ?? {})) headers.push(`"${k}": "${v}"`);
  if (headers.length) args.push(`    headers={${headers.join(", ")}},`);
  if (spec.query) args.push(`    params=${pyLiteral(spec.query).replace(/\n/g, "\n    ")},`);
  if (spec.body !== undefined)
    args.push(`    json=${pyLiteral(spec.body).replace(/\n/g, "\n    ")},`);
  return [
    "import requests",
    "",
    `res = requests.${spec.method.toLowerCase()}(`,
    ...args,
    ")",
    spec.method === "DELETE" ? "print(res.status_code)" : "print(res.status_code, res.json())",
  ].join("\n");
}

export const snippets = (spec: Spec, origin: string) => ({
  curl: curl(spec, origin),
  js: js(spec, origin),
  python: python(spec, origin),
});

/** The request for each operation in the reference, keyed `METHOD /path` as in the OpenAPI document. */
export const OPERATION_SPECS: Record<string, Spec> = {
  "POST /v1/sandbox": { method: "POST", path: "/v1/sandbox", auth: false, after: "sandbox" },
  "GET /v1/resources": { method: "GET", path: "/v1/resources", query: { limit: "20" } },
  "POST /v1/resources": {
    method: "POST",
    path: "/v1/resources",
    body: { name: "Room C — podcast", timezone: "Europe/Istanbul", slot_minutes: 60, capacity: 1 },
  },
  "GET /v1/resources/{id}": { method: "GET", path: "/v1/resources/{{resource_id}}" },
  "GET /v1/resources/{id}/rules": { method: "GET", path: "/v1/resources/{{resource_id}}/rules" },
  "PUT /v1/resources/{id}/rules": {
    method: "PUT",
    path: "/v1/resources/{{resource_id}}/rules",
    body: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 540, end_minute: 1080 })),
  },
  "GET /v1/resources/{id}/availability": {
    method: "GET",
    path: "/v1/resources/{{resource_id}}/availability",
    query: { from: "{{from}}", to: "{{to}}" },
    after: "slot",
  },
  "POST /v1/bookings": {
    method: "POST",
    path: "/v1/bookings",
    headers: { "Idempotency-Key": "{{idem}}" },
    body: {
      resource_id: "{{resource_id}}",
      starts_at: "{{starts_at}}",
      ends_at: "{{ends_at}}",
      customer_name: "Deniz Aksoy",
      customer_email: "deniz@example.com",
      hold: true,
      hold_minutes: 10,
    },
    after: "booking",
  },
  "GET /v1/bookings": { method: "GET", path: "/v1/bookings", query: { limit: "5" } },
  "GET /v1/bookings/{id}": { method: "GET", path: "/v1/bookings/{{booking_id}}" },
  "POST /v1/bookings/{id}/confirm": {
    method: "POST",
    path: "/v1/bookings/{{booking_id}}/confirm",
    after: "booking",
  },
  "POST /v1/bookings/{id}/cancel": {
    method: "POST",
    path: "/v1/bookings/{{booking_id}}/cancel",
    after: "booking",
  },
  "GET /v1/webhooks": { method: "GET", path: "/v1/webhooks" },
  "POST /v1/webhooks": {
    method: "POST",
    path: "/v1/webhooks",
    body: { url: "{{sink}}", events: ["*"] },
    after: "webhook",
  },
  "DELETE /v1/webhooks/{id}": {
    method: "DELETE",
    path: "/v1/webhooks/{{webhook_id}}",
    after: "webhookGone",
  },
  "POST /v1/webhooks/{id}/test": { method: "POST", path: "/v1/webhooks/{{webhook_id}}/test" },
  "GET /v1/webhooks/deliveries": {
    method: "GET",
    path: "/v1/webhooks/deliveries",
    query: { limit: "10" },
  },
  "POST /v1/payments/webhook": {
    method: "POST",
    path: "/v1/payments/webhook",
    auth: false,
    sign: true,
    body: {
      provider_ref: "{{provider_ref}}",
      booking_id: "{{booking_id}}",
      amount_minor: 12000,
      currency: "GBP",
      status: "succeeded",
    },
    after: "booking",
  },
};

/** A code panel: three tabs, a Run button, and a place for the response. */
export function codePanel(
  spec: Spec,
  origin: string,
  opts: { id: string; label: string; again?: boolean },
) {
  const s = snippets(spec, origin);
  const data = JSON.stringify({ spec, snippets: s }).replace(/</g, "\\u003c");
  const tabs = (["curl", "js", "python"] as const)
    .map(
      (lang, i) =>
        `<button type="button" role="tab" id="${opts.id}-tab-${lang}" aria-controls="${opts.id}-code" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-lang="${lang}">${{ curl: "curl", js: "JavaScript", python: "Python" }[lang]}</button>`,
    )
    .join("");
  return `<div class="code" data-panel id="${opts.id}">
  <script type="application/json">${data}</script>
  <div class="code-bar"><div role="tablist" aria-label="Language for ${opts.label}">${tabs}</div><span class="sp"></span><button type="button" class="copy" data-copy>Copy</button></div>
  <pre id="${opts.id}-code" role="tabpanel" tabindex="0" aria-label="${opts.label}, code"><code>${s.curl.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>
  <div class="run-bar"><button type="button" class="btn primary sm" data-run><span class="spin" aria-hidden="true"></span>Run</button>${opts.again ? '<button type="button" class="btn ghost sm" data-run-again>Send again</button>' : ""}<span class="hint" data-hint>Runs against your own sandbox.</span></div>
  <div class="response" data-response hidden aria-live="polite"></div>
</div>`;
}
