/**
 * Whether a webhook URL may be called, and if not, why.
 *
 * A webhook is a request the server makes to an address a client chose, which makes it the
 * classic server-side request forgery opening (OWASP API7). The rule is narrow on purpose:
 * HTTPS on the default port to a public DNS name. IP literals in any spelling are refused —
 * the URL parser has already turned `0x7f.1` and `2130706433` into `127.0.0.1` — as are
 * single-label hosts and the names reserved for private networks.
 *
 * This is the application's own check and it does not resolve DNS, so a public name that
 * points at a private address is outside what it can see. The request itself leaves from
 * Cloudflare's network, which has no route into anyone's private one.
 */

const PRIVATE_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "home.arpa",
  "test",
  "example",
  "invalid",
];

export function webhookUrlProblem(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "is not a URL";
  }
  if (url.protocol !== "https:") return "must use https";
  if (url.username || url.password) return "must not carry credentials";
  if (url.port !== "" && url.port !== "443") return "must use the default HTTPS port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return "must be a DNS name, not an IP address";
  if (!host.includes(".")) return "must be a fully qualified domain name";
  if (PRIVATE_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`)))
    return "must be a public host name";
  return null;
}
