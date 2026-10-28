// @ts-check
/**
 * The webhook guide's signer and checker, in the browser: the same HMAC-SHA256 over
 * `t + "." + raw body` that the API sends as `X-Slot-Signature`, shown step by step, and a
 * field that checks a header against it — the signature and the five-minute window both.
 */

const root = document.querySelector("[data-verify]");
const enc = new TextEncoder();

/** @param {string} secret @param {string} message */
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

if (root) {
  const field = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement | HTMLTextAreaElement} */ (root.querySelector(`[data-v-${name}]`));
  const secret = field("secret");
  const t = field("t");
  const body = field("body");
  const check = field("check");
  const out = (/** @type {string} */ name) => /** @type {HTMLElement} */ (root.querySelector(`[data-v-${name}]`));
  t.value = String(Math.floor(Date.now() / 1000));
  let header = "";

  const sign = async () => {
    const signed = `${t.value}.${body.value}`;
    const mac = await hmac(secret.value, signed);
    header = `t=${t.value},v1=${mac}`;
    out("signed").textContent = signed.length > 90 ? `${signed.slice(0, 87)}…` : signed;
    out("mac").textContent = mac;
    out("header").textContent = header;
    if (!check.value) check.placeholder = header;
    await verify();
  };

  const verify = async () => {
    const result = out("result");
    const given = check.value.trim();
    if (!given) return void (result.textContent = "Paste a header, or copy the one above and change the body by one character.");
    const parts = Object.fromEntries(given.split(",").map((p) => p.split("=").map((s) => s.trim())));
    if (!parts.t || !parts.v1) return void ((result.dataset.ok = "false"), (result.textContent = "A header needs both t= and v1=."));
    const expected = await hmac(secret.value, `${parts.t}.${body.value}`);
    const age = Math.floor(Date.now() / 1000) - Number(parts.t);
    const ok = expected === parts.v1 && Math.abs(age) <= 300;
    result.dataset.ok = String(ok);
    result.textContent =
      expected !== parts.v1
        ? "✗ Signature does not match this body and secret — reject it."
        : Math.abs(age) > 300
          ? `✗ Signature matches, but it was made ${Math.round(age / 60)} minutes ago — reject replays older than five.`
          : "✓ Valid: signed with this secret over these exact bytes, within five minutes.";
  };

  for (const el of [secret, t, body]) el.addEventListener("input", sign);
  check.addEventListener("input", verify);
  check.addEventListener("focus", () => {
    if (!check.value) check.value = header;
    verify();
  });
  sign();
}

// Loaded as a module; this keeps its top-level names its own.
export {};
