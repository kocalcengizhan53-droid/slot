/**
 * The performance gate: Lighthouse's mobile profile, three runs per page, the median against a
 * budget per page. One run is not a measurement — the same page scores 74 and 92 on consecutive
 * runs — and a gate that flips on noise is a gate people learn to ignore.
 *
 * Lighthouse slows the CPU by a fixed factor whatever the host, so the same build scores a few
 * points lower on a slower or busier machine (benchmark index 2,900 against 3,900 moved one page
 * from 92 to 89). Performance therefore has two lines: below the budget fails, below the target
 * of 90 only warns. The budget catches regressions; the target is what we aim for and report.
 *
 *   QA_URL=http://localhost:3300 node qa/lighthouse.mjs
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const BASE = (process.env.QA_URL ?? "http://localhost:8787").replace(/\/$/, "")
const RUNS = Number(process.env.LH_RUNS ?? 3)
const OUT = "qa-output/lighthouse"

/** Budgets are minimum scores out of 100; a page may lower performance only with a reason. */
const PAGES = [
  { name: "home", path: "/" },
  { name: "reference", path: "/docs/reference" },
  { name: "playground", path: "/playground" },
  { name: "status", path: "/status" },
]

const DEFAULT = { performance: 85, accessibility: 95, "best-practices": 90, seo: 90 }
const TARGET = 90
const warnings = []
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
mkdirSync(OUT, { recursive: true })

const flags = ["--headless=new", ...(process.env.CI ? ["--no-sandbox"] : [])].join(" ")
const failures = []
const summary = []

for (const page of PAGES) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const file = `${OUT}/${page.name}-${i}.json`
    const r = spawnSync(
      "npx",
      ["--yes", "lighthouse@13.5.0", BASE + page.path, "--output=json", `--output-path=${file}`, "--quiet", `--chrome-flags=${flags}`],
      { stdio: "inherit" }
    )
    if (r.status !== 0) {
      failures.push(`${page.path}: Lighthouse exited with ${r.status}`)
      break
    }
    const report = JSON.parse(readFileSync(file, "utf8"))
    runs.push({
      scores: Object.fromEntries(Object.entries(report.categories).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)])),
      tbt: Math.round(report.audits["total-blocking-time"].numericValue),
      benchmark: Math.round(report.environment.benchmarkIndex),
      lcp: Math.round(report.audits["largest-contentful-paint"].numericValue),
    })
  }
  if (!runs.length) continue
  const budget = { ...DEFAULT, ...page.budget }
  const result = { page: page.path, runs: runs.length }
  for (const [category, min] of Object.entries(budget)) {
    const score = median(runs.map((r) => r.scores[category]))
    result[category] = score
    if (score < min) failures.push(`${page.path}: ${category} ${score} < ${min}${page.why ? ` (${page.why})` : ""}`)
  }
  if (result.performance < TARGET && result.performance >= budget.performance)
    warnings.push(`${page.path}: performance ${result.performance}, under the target of ${TARGET}`)
  result.tbt = median(runs.map((r) => r.tbt))
  result.lcp = median(runs.map((r) => r.lcp))
  summary.push(result)
  console.log(
    `${page.path.padEnd(28)} perf ${result.performance}  a11y ${result.accessibility}  bp ${result["best-practices"]}  seo ${result.seo}  ` +
      `TBT ${result.tbt} ms  LCP ${(result.lcp / 1000).toFixed(1)} s  (median of ${runs.length}, host benchmark ${median(runs.map((r) => r.benchmark))})`
  )
}

writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2))
if (warnings.length) console.warn(`\nUnder target:\n  ${warnings.join("\n  ")}`)
if (failures.length) {
  console.error(`\nLighthouse gate failed:\n  ${failures.join("\n  ")}`)
  process.exit(1)
}
console.log("\nLighthouse gate passed")
