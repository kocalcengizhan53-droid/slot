import type { After } from "../page";
import { LIVE, id, now, type Queryable, type Resource, type Rule, type Booking } from "./shared";

/** Resources, their weekly hours, and the inputs the slot calculation needs. */
export function resourcesQueries(d1: Queryable) {
  const rules = (resourceId: string) =>
    d1
      .prepare(
        "SELECT * FROM availability_rules WHERE resource_id = ? ORDER BY weekday, start_minute",
      )
      .bind(resourceId);

  return {
    resources: (tenantId: string, limit: number, after: After | null) =>
      d1
        .prepare(
          `SELECT * FROM resources WHERE tenant_id = ?1
             AND (?2 IS NULL OR created_at > ?2 OR (created_at = ?2 AND id > ?3))
           ORDER BY created_at, id LIMIT ?4`,
        )
        .bind(tenantId, after?.sort ?? null, after?.id ?? null, limit + 1)
        .all<Resource>()
        .then((r) => r.results),

    resource: (tenantId: string, resourceId: string) =>
      d1
        .prepare("SELECT * FROM resources WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, resourceId)
        .first<Resource>(),

    countResources: (tenantId: string) =>
      d1
        .prepare("SELECT COUNT(*) AS n FROM resources WHERE tenant_id = ?")
        .bind(tenantId)
        .first<number>("n"),

    createResource: async (r: Omit<Resource, "created_at">) => {
      const created = { ...r, created_at: now() };
      await d1
        .prepare(
          "INSERT INTO resources (id, tenant_id, name, timezone, slot_minutes, capacity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(r.id, r.tenant_id, r.name, r.timezone, r.slot_minutes, r.capacity, created.created_at)
        .run();
      return created;
    },

    rules: (resourceId: string) =>
      rules(resourceId)
        .all<Rule>()
        .then((r) => r.results),

    replaceRules: async (resourceId: string, next: Omit<Rule, "id" | "resource_id">[]) => {
      await d1.batch([
        d1.prepare("DELETE FROM availability_rules WHERE resource_id = ?").bind(resourceId),
        ...next.map((r) =>
          d1
            .prepare(
              "INSERT INTO availability_rules (id, resource_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(id("rule"), resourceId, r.weekday, r.start_minute, r.end_minute),
        ),
      ]);
    },

    /**
     * Everything availability and booking need, in one round trip: the resource (scoped to the
     * tenant), its rules, the bookings that take capacity in the window, and the tenant's
     * booking count for the sandbox quota. Rules and bookings are filtered through the
     * resource's tenant, so a foreign id returns nothing at all.
     */
    slotInputs: async (tenantId: string, resourceId: string, from: string, to: string) => {
      const t = now();
      const [resource, ruleRows, busy, count] = await d1.batch([
        d1
          .prepare("SELECT * FROM resources WHERE tenant_id = ? AND id = ?")
          .bind(tenantId, resourceId),
        d1
          .prepare(
            `SELECT a.* FROM availability_rules a JOIN resources r ON r.id = a.resource_id
             WHERE r.tenant_id = ? AND a.resource_id = ? ORDER BY a.weekday, a.start_minute`,
          )
          .bind(tenantId, resourceId),
        d1
          .prepare(
            `SELECT * FROM bookings WHERE tenant_id = ? AND resource_id = ? AND starts_at < ? AND ends_at > ? AND ${LIVE}`,
          )
          .bind(tenantId, resourceId, to, from, t),
        d1.prepare("SELECT COUNT(*) AS n FROM bookings WHERE tenant_id = ?").bind(tenantId),
      ]);
      return {
        resource: (resource.results[0] as Resource | undefined) ?? null,
        rules: ruleRows.results as Rule[],
        busy: busy.results as Booking[],
        bookingCount: (count.results[0] as { n: number }).n,
      };
    },
  };
}
