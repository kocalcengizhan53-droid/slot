import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import type { AppEnv } from "../auth";
import { id } from "../db";
import { slotsForDay } from "../lib/slots";
import { addDays, dayBounds, formatLocalDate, isTimeZone, iso, parseLocalDate } from "../lib/time";
import {
  AvailabilitySchema,
  ErrorBody,
  Id,
  LocalDate,
  NewResource,
  ResourceSchema,
  RuleSchema,
} from "../schemas";

export const resources = new OpenAPIHono<AppEnv>();

const tags = ["Resources"];

resources.openapi(
  createRoute({
    method: "get",
    path: "/resources",
    tags,
    summary: "List resources",
    responses: {
      200: {
        description: "The tenant's resources",
        content: { "application/json": { schema: z.array(ResourceSchema) } },
      },
    },
  }),
  async (c) => c.json(await c.get("db").resources(c.get("tenant").id), 200),
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
      422: {
        description: "Unknown time zone",
        content: { "application/json": { schema: ErrorBody } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    if (!isTimeZone(body.timezone)) {
      return c.json(
        {
          error: {
            code: "invalid_timezone",
            message: `"${body.timezone}" is not an IANA time zone.`,
          },
        },
        422,
      );
    }
    const d = c.get("db");
    const resource = { id: id("res"), tenant_id: c.get("tenant").id, ...body };
    await d.createResource(resource);
    return c.json((await d.resource(resource.tenant_id, resource.id))!, 201);
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const r = await c.get("db").resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return c.json({ error: { code: "not_found", message: "No such resource." } }, 404);
    return c.json(r, 200);
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const r = await d.resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return c.json({ error: { code: "not_found", message: "No such resource." } }, 404);
    const rules = await d.rules(r.id);
    return c.json(
      rules.map(({ weekday, start_minute, end_minute }) => ({ weekday, start_minute, end_minute })),
      200,
    );
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const r = await d.resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return c.json({ error: { code: "not_found", message: "No such resource." } }, 404);
    await d.replaceRules(r.id, c.req.valid("json"));
    const rules = await d.rules(r.id);
    return c.json(
      rules.map(({ weekday, start_minute, end_minute }) => ({ weekday, start_minute, end_minute })),
      200,
    );
  },
);

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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
      422: { description: "Bad range", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const r = await d.resource(c.get("tenant").id, c.req.valid("param").id);
    if (!r) return c.json({ error: { code: "not_found", message: "No such resource." } }, 404);
    const { from, to } = c.req.valid("query");
    const first = parseLocalDate(from);
    const last = to ? parseLocalDate(to) : first;
    if (!first || !last)
      return c.json({ error: { code: "invalid_date", message: "Dates are YYYY-MM-DD." } }, 422);
    const days: { year: number; month: number; day: number }[] = [];
    for (
      let day = first;
      days.length <= 31 && formatLocalDate(day) <= formatLocalDate(last);
      day = addDays(day, 1)
    )
      days.push(day);
    if (days.length > 31)
      return c.json(
        { error: { code: "range_too_long", message: "At most 31 days at a time." } },
        422,
      );

    const rules = await d.rules(r.id);
    const windowStart = iso(dayBounds(days[0], r.timezone).start);
    const windowEnd = iso(dayBounds(days[days.length - 1], r.timezone).end);
    const busy = await d.busy(r.id, windowStart, windowEnd);
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
