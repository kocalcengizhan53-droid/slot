/**
 * The accessibility gate: axe-core with the WCAG 2.2 AA rule sets and best practice, on every
 * page at a phone width and a desktop width, after scrolling so lazily mounted content is
 * there to test. Zero violations; anything else fails the build.
 *
 *   QA_URL=http://localhost:3300 node qa/axe.mjs
 */
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const BASE = (process.env.QA_URL ?? "http://localhost:8787").replace(/\/$/, "")
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")
const PAGES = ["/", "/docs/reference", "/docs/guides", "/docs/errors", "/status", "/playground"]
const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"]

const browser = await chromium.launch({ channel: "chrome" })
const failures = []
for (const width of [390, 1440]) {
  for (const path of PAGES) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" })
    const page = await context.newPage()
    await page.goto(BASE + path, { waitUntil: "networkidle" })
    for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 700) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      await page.waitForTimeout(80)
    }
    await page.waitForTimeout(400)
    await page.addScriptTag({ content: AXE })
    const violations = await page.evaluate(
      async (tags) =>
        (await window.axe.run(document, { runOnly: { type: "tag", values: tags } })).violations.map(
          (v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`
        ),
      TAGS
    )
    console.log(`${String(width).padStart(4)}  ${path.padEnd(28)} ${violations.length ? violations.join("; ") : "0"}`)
    for (const v of violations) failures.push(`${path} @${width}: ${v}`)
    await context.close()
  }
}
await browser.close()
if (failures.length) {
  console.error(`\naxe gate failed:\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\naxe gate passed")
