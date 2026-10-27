/**
 * Server time per API operation, measured on real requests and kept as histograms.
 *
 * Each isolate counts requests into buckets in memory and writes them to D1 as one batched
 * upsert at most every ten seconds, so a busy minute costs a handful of writes instead of one
 * per request. Percentiles are interpolated within buckets: p95 is "somewhere in 75–100 ms,
 * about here", which is as exact as a dashboard needs and costs one row per operation per
 * five minutes. An isolate that is evicted before it flushes loses at most ten seconds.
 */

/** Upper bounds in ms for buckets 0–15; bucket 16 holds everything slower. */
export const BOUNDS = [2, 5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000, 2000];
const BUCKETS = BOUNDS.length + 1;
const COLUMNS = Array.from({ length: BUCKETS }, (_, i) => `b${String(i).padStart(2, "0")}`);
const PERIOD_MINUTES = 5;
const FLUSH_MS = 10_000;

export function bucketOf(ms: number): number {
  const i = BOUNDS.findIndex((b) => ms <= b);
  return i === -1 ? BOUNDS.length : i;
}

/** The p-th percentile (0–1) of a histogram, or null when it is empty. */
export function percentile(counts: number[], p: number): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = p * total;
  let below = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && below + counts[i] >= target) {
      const lo = i === 0 ? 0 : BOUNDS[i - 1];
      const hi = i < BOUNDS.length ? BOUNDS[i] : BOUNDS[BOUNDS.length - 1] * 2;
      return lo + ((hi - lo) * (target - below)) / counts[i];
    }
    below += counts[i];
  }
  return BOUNDS[BOUNDS.length - 1] * 2;
}

/** Maps a concrete path to its OpenAPI operation, `GET /v1/resources/{id}`, or null. */
export function operationMatcher(operations: Iterable<string>) {
  const compiled = [...operations]
    .map((op) => {
      const [method, template] = op.split(" ");
      const params = (template.match(/\{[^}]+\}/g) ?? []).length;
      const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
      return { op, method, pattern, params };
    })
    // Prefer the most literal template: /webhooks/deliveries over /webhooks/{id}.
    .sort((a, b) => a.params - b.params);
  return (method: string, path: string) =>
    compiled.find((c) => c.method === method && c.pattern.test(path))?.op ?? null;
}

export function periodOf(at: Date): string {
  const d = new Date(at);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() - (d.getUTCMinutes() % PERIOD_MINUTES));
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

type Pending = { period: string; operation: string; count: number; buckets: number[] };
const pending = new Map<string, Pending>();
let lastFlush = 0;

export function record(operation: string, ms: number, at = new Date()) {
  const period = periodOf(at);
  const key = `${period} ${operation}`;
  let row = pending.get(key);
  if (!row) {
    row = { period, operation, count: 0, buckets: new Array(BUCKETS).fill(0) };
    pending.set(key, row);
  }
  row.count += 1;
  row.buckets[bucketOf(ms)] += 1;
}

export const flushDue = (now = Date.now()) => pending.size > 0 && now - lastFlush >= FLUSH_MS;

const UPSERT = `INSERT INTO latency (period, operation, count, ${COLUMNS.join(", ")})
VALUES (?, ?, ?, ${COLUMNS.map(() => "?").join(", ")})
ON CONFLICT (period, operation) DO UPDATE SET count = count + excluded.count, ${COLUMNS.map(
  (c) => `${c} = ${c} + excluded.${c}`,
).join(", ")}`;

export async function flush(d1: D1Database) {
  const rows = [...pending.values()];
  pending.clear();
  lastFlush = Date.now();
  if (rows.length === 0) return;
  await d1.batch(
    rows.map((r) => d1.prepare(UPSERT).bind(r.period, r.operation, r.count, ...r.buckets)),
  );
}

type Summed = { count: number; buckets: number[] };
const SUMS = `SUM(count) AS count, ${COLUMNS.map((c) => `SUM(${c}) AS ${c}`).join(", ")}`;
const toSummed = (row: Record<string, number>): Summed => ({
  count: row.count ?? 0,
  buckets: COLUMNS.map((c) => row[c] ?? 0),
});
const describe = (s: Summed) => ({
  count: s.count,
  p50: round(percentile(s.buckets, 0.5)),
  p95: round(percentile(s.buckets, 0.95)),
  p99: round(percentile(s.buckets, 0.99)),
});
const round = (n: number | null) => (n === null ? null : Math.round(n));

/** The last day, per operation and hour by hour across all of them. */
export async function summary(d1: D1Database, now = new Date()) {
  const since = periodOf(new Date(now.getTime() - 24 * 3_600_000));
  const [perOperation, hourly] = await d1.batch<
    Record<string, number> & { operation: string; hour: string }
  >([
    d1
      .prepare(`SELECT operation, ${SUMS} FROM latency WHERE period >= ? GROUP BY operation`)
      .bind(since),
    d1
      .prepare(
        `SELECT substr(period, 1, 13) AS hour, ${SUMS} FROM latency WHERE period >= ? GROUP BY hour ORDER BY hour`,
      )
      .bind(since),
  ]);
  const all = (perOperation.results ?? []).map(toSummed).reduce<Summed>(
    (acc, s) => ({
      count: acc.count + s.count,
      buckets: acc.buckets.map((b, i) => b + s.buckets[i]),
    }),
    { count: 0, buckets: new Array(BUCKETS).fill(0) },
  );
  return {
    window_hours: 24,
    overall: describe(all),
    operations: (perOperation.results ?? [])
      .map((row) => ({ operation: row.operation, ...describe(toSummed(row)) }))
      .sort((a, b) => b.count - a.count),
    hourly: (hourly.results ?? []).map((row) => ({
      hour: `${row.hour}:00Z`,
      ...describe(toSummed(row)),
    })),
  };
}

export const purgeLatency = (d1: D1Database, now = new Date()) =>
  d1
    .prepare("DELETE FROM latency WHERE period < ?")
    .bind(periodOf(new Date(now.getTime() - 7 * 24 * 3_600_000)))
    .run();
