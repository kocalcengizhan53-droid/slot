import { STYLES } from "./styles";

/**
 * The page shell every portal page shares: metadata a link preview needs, the theme set
 * before first paint so there is no flash, the stylesheet inlined, and one deferred script.
 */

export const esc = (s: unknown) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Inline Markdown-ish: `code` and nothing else, for descriptions written in the route files. */
export const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

export const REPO = "https://github.com/kocalcengizhan53-droid/slot";

const NAV = [
  ["/", "Quickstart"],
  ["/docs/reference", "API reference"],
  ["/docs/guides", "Guides"],
  ["/docs/errors", "Errors"],
  ["/status", "Status"],
  ["/playground", "Playground"],
] as const;

export const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b0c0f" stroke="#2f3340"/><g fill="#343a48"><rect x="6" y="6" width="5.5" height="5.5" rx="1.6"/><rect x="13.25" y="6" width="5.5" height="5.5" rx="1.6"/><rect x="20.5" y="6" width="5.5" height="5.5" rx="1.6"/><rect x="6" y="13.25" width="5.5" height="5.5" rx="1.6"/><rect x="20.5" y="13.25" width="5.5" height="5.5" rx="1.6"/><rect x="6" y="20.5" width="5.5" height="5.5" rx="1.6"/><rect x="13.25" y="20.5" width="5.5" height="5.5" rx="1.6"/><rect x="20.5" y="20.5" width="5.5" height="5.5" rx="1.6"/></g><rect x="13.25" y="13.25" width="5.5" height="5.5" rx="1.6" fill="#f6c453"/></svg>`;

const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const GITHUB = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>`;

export type Page = {
  title: string;
  description: string;
  path: string;
  origin: string;
  body: string;
  /** Extra module scripts for this page, served from public/. */
  scripts?: string[];
};

export function page({ title, description, path, origin, body, scripts = [] }: Page) {
  const fullTitle =
    path === "/" ? "Slot — a reservations API that cannot double-book" : `${title} · Slot`;
  const url = `${origin}${path}`;
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${href === path || (href !== "/" && path.startsWith(href)) ? ' aria-current="page"' : ""}>${label}</a>`,
  ).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Slot">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(origin)}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0a0b0e">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/geist-5.3.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/geist-mono-5.3.woff2" as="font" type="font/woff2" crossorigin>
<script>document.documentElement.classList.add("js");try{var t=localStorage.getItem("slot.theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${STYLES}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Slot, home">${MARK}<span>Slot</span></a>
    <nav class="nav" aria-label="Portal">${nav}</nav>
    <div class="top-actions">
      <a class="status-pill" href="/status" data-status-pill><span class="dot" aria-hidden="true"></span><span class="label">API</span><span data-lat="overall.p95">p95 —</span></a>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="Switch between light and dark">${SUN}</button>
      <a class="icon-btn" href="${REPO}" aria-label="Source on GitHub">${GITHUB}</a>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer>
  <div class="wrap">
    <p>Slot · Hono on Cloudflare Workers and D1 · OpenAPI 3.1 · built by Kocal</p>
    <nav aria-label="Footer"><a href="/openapi.json">openapi.json</a><a href="/docs/guides">Guides</a><a href="/status">Status</a><a href="${REPO}">Source</a></nav>
  </div>
</footer>
<div class="toast" role="status" aria-live="polite" data-toast></div>
<script type="module" src="/portal.js"></script>
${scripts.map((s) => `<script type="module" src="${s}"></script>`).join("\n")}
</body>
</html>`;
}
