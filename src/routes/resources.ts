import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import type { AppEnv } from "../auth";
import { id, type Resource } from "../db";
import { slotsForDay } from "../lib/slots";
import { addDays, formatLocalDate, isTimeZone, iso, parseLocalDate } from "../lib/time";
import { PageQuery, decodeCursor, listOf, page } from "../page";
import { problem, problemContent } from "../problem";
import { SANDBOX_LIMITS } from "../sandbox";
import {
  AvailabilitySchema,
  Id,
  LocalDate,
  NewResource,
  ResourceSchema,
  RuleSchema,
} from "../schemas";

export const resources = new OpenAPIHono<AppEnv>();

const tags = ["Resources"];

const publicResource = ({ tenant_id: _tenant, ...rest }: Resource) => {
  void _tenant;
  return rest;
};
const publicRules = (rules: { weekday: number; start_minute: number; end_minute: number }[]) =>
  rules.map(({ weekday, start_minute, end_minute }) => ({ weekday, start_minute, end_minute }));

resources.openapi(
  createRoute({
    method: "get",
    path: "/resources",
    tags,
    summary: "List resources",
    description: "Oldest first.",
    request: { query: PageQuery },
    responses: {
      200: {
        description: "A page of the tenant's resources",
        content: { "application/json": { schema: listOf(ResourceSchema, "ResourceList") } },
      },
      422: { description: "Invalid cursor", content: problemContent },
    },
  }),
  async (c) => {
    const { limit, cursor } = c.req.valid("query");
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after)
      return problem(c, 422, "invalid_cursor", "That cursor did not come from this list.");
    const rows = await c.get("db").resources(c.get("tenant").id, limit, after);
    const result = page(rows, limit, (r) => ({ sort: r.created_at, id: r.id }));
    return c.json({ data: result.data.map(publicResource), next_cursor: result.next_cursor }, 200);
  },
);

resources.openapi(
  createRoute({
    method: "post",
    path: "/resources",
    tags,
    summary: "Create a resource",
    request: { body: { content: { "application/json": { schema: NewResource } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: ResourceSchema } } },
      403: { description: "Sandbox quota reached", content: problemContent },
      422: { description: "Unknown time zone", content: problemContent },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    if (!isTimeZone(body.timezone))
      return problem(c, 422, "invalid_timezone", `"${body.timezone}" is not an IANA time zone.`);
    const d = c.get("db");
    const tenant = c.get("tenant");
    if (
      tenant.kind === "sandbox" &&
      ((await d.countResources(tenant.id)) ?? 0) >= SANDBOX_LIMITS.resources
    )
      return problem(
        c,
        403,
        "quota_exceeded",
        `A sandbox holds up to ${SANDBOX_LIMITS.resources} resources.`,
      );
    const created = await d.createResource({ id: id("res"), tenant_id: tenant.id, ...body });
    return c.json(publicResource(created), 201);
  },
);

resources.openapi(
  createRoute({
    method: "get",
    path: "/resources/{id}",
    tags,
    summary: "Get a resource",
    request: { params: z.object({ id: Id }) },
    responses: {
      200: {
        description: "The resource",
        content: { "application/json": { schema: ResourceSchema } },
      },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const r = await c.get("db").resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return problem(c, 404, "not_found", "No such resource.");
    return c.json(publicResource(r), 200);
  },
);

resources.openapi(
  createRoute({
    method: "get",
    path: "/resources/{id}/rules",
    tags,
    summary: "Weekly availability rules",
    request: { params: z.object({ id: Id }) },
    responses: {
      200: {
        description: "Rules, in the resource's zone",
        content: { "application/json": { schema: z.array(RuleSchema) } },
      },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const r = await d.resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return problem(c, 404, "not_found", "No such resource.");
    return c.json(publicRules(await d.rules(r.id)), 200);
  },
);

resources.openapi(
  createRoute({
    method: "put",
    path: "/resources/{id}/rules",
    tags,
    summary: "Replace the weekly availability rules",
    request: {
      params: z.object({ id: Id }),
      body: { content: { "application/json": { schema: z.array(RuleSchema).max(50) } } },
    },
    responses: {
      200: {
        description: "The rules now in force",
        content: { "application/json": { schema: z.array(RuleSchema) } },
      },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const r = await d.resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return problem(c, 404, "not_found", "No such resource.");
    const next = c.req.valid("json");
    await d.replaceRules(r.id, next);
    return c.json(
      publicRules(
        [...next].sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute),
      ),
      200,
    );
  },
);

/** No zone is more than fourteen hours from UTC, so this window holds every local day asked for. */
const ZONE_SLACK_MS = 14 * 3_600_000;

resources.openapi(
  createRoute({
    method: "get",
    path: "/resources/{id}/availability",
    tags,
    summary: "Free slots between two local dates",
    description:
      "Every slot the resource offers on each day, with how many bookings it can still take. Dates are local to the resource's zone; instants are UTC. At most 31 days.",
    request: {
      params: z.object({ id: Id }),
      query: z.object({ from: LocalDate, to: LocalDate.optional() }),
    },
    responses: {
      200: {
        description: "Availability",
        content: { "application/json": { schema: AvailabilitySchema } },
      },
      404: { description: "Not found", content: problemContent },
      422: { description: "Bad range", content: problemContent },
    },
  }),
  async (c) => {
    const { from, to } = c.req.valid("query");
    const first = parseLocalDate(from);
    const last = to ? parseLocalDate(to) : first;
    if (!first || !last)
      return problem(c, 422, "invalid_date", "Dates are real calendar days, YYYY-MM-DD.");
    const days: { year: number; month: number; day: number }[] = [];
    for (
      let day = first;
      days.length <= 31 && formatLocalDate(day) <= formatLocalDate(last);
      day = addDays(day, 1)
    )
      days.push(day);
    if (days.length > 31) return problem(c, 422, "range_too_long", "At most 31 days at a time.");
    if (days.length === 0) return problem(c, 422, "invalid_date", "`to` is before `from`.");

    // One round trip: the resource, its rules and the bookings in a window wide enough for
    // any zone. The slot grid then counts only the bookings that overlap each slot.
    const windowStart = iso(
      new Date(Date.parse(`${formatLocalDate(days[0])}T00:00:00Z`) - ZONE_SLACK_MS),
    );
    const windowEnd = iso(
      new Date(
        Date.parse(`${formatLocalDate(addDays(days[days.length - 1], 1))}T00:00:00Z`) +
          ZONE_SLACK_MS,
      ),
    );
    const {
      resource: r,
      rules,
      busy,
    } = await c
      .get("db")
      .slotInputs(c.get("tenant").id, c.req.valid("param").id, windowStart, windowEnd);
    if (!r) return problem(c, 404, "not_found", "No such resource.");
    return c.json(
      {
        resource_id: r.id,
        timezone: r.timezone,
        slot_minutes: r.slot_minutes,
        days: days.map((day) => ({
          date: formatLocalDate(day),
          slots: slotsForDay(day, r.timezone, r.slot_minutes, r.capacity, rules, busy),
        })),
      },
      200,
    );
  },
);
