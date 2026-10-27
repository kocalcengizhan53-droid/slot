import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { idempotent, type AppEnv, type Reply } from "../auth";
import { id, type Booking } from "../db";
import { emit } from "../events";
import { canBook } from "../lib/slots";
import { iso } from "../lib/time";
import { PageQuery, decodeCursor, listOf, page } from "../page";
import { PROBLEM_HEADERS, problem, problemBody, problemContent } from "../problem";
import { SANDBOX_LIMITS } from "../sandbox";
import { BookingSchema, Id, NewBooking } from "../schemas";

export const bookings = new OpenAPIHono<AppEnv>();

const tags = ["Bookings"];

const publicBooking = (b: Booking) => {
  // Expired holds read as cancelled the moment they expire, whatever the cron has got to.
  const expired =
    b.status === "held" && b.hold_expires_at !== null && b.hold_expires_at <= iso(new Date());
  const { tenant_id: _tenant, ...rest } = b;
  void _tenant;
  return { ...rest, status: expired ? ("cancelled" as const) : b.status };
};

bookings.openapi(
  createRoute({
    method: "post",
    path: "/bookings",
    tags,
    summary: "Book a slot, or hold it",
    description:
      "Confirms a booking, or with `hold: true` holds the slot for `hold_minutes` until it is confirmed. Checked against the resource's hours, its slot grid and its capacity in one atomic statement, so two requests for the last place cannot both succeed. Send an `Idempotency-Key` header and a retried request returns the original booking.",
    request: {
      headers: z.object({ "idempotency-key": z.string().max(200).optional() }),
      body: { content: { "application/json": { schema: NewBooking } } },
    },
    responses: {
      201: {
        description: "Booked or held",
        content: { "application/json": { schema: BookingSchema } },
      },
      404: {
        description: "No such resource",
        content: problemContent,
      },
      403: { description: "Sandbox quota reached", content: problemContent },
      409: {
        description:
          "Cannot be booked — full, outside hours, off the slot grid — or the first request under this Idempotency-Key is still running",
        content: problemContent,
      },
      422: {
        description: "Idempotency-Key reused with a different request",
        content: problemContent,
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const d = c.get("db");
    const tenant = c.get("tenant");
    const reply = await idempotent(c, async (): Promise<Reply> => {
      const fail = (
        status: 403 | 404 | 409,
        code: Parameters<typeof problemBody>[2],
        detail: string,
      ) => ({
        status,
        body: problemBody(c, status, code, detail),
      });
      if (body.ends_at <= body.starts_at)
        return fail(409, "off_grid", "ends_at must be after starts_at.");
      const {
        resource: r,
        rules,
        busy,
        bookingCount,
      } = await d.slotInputs(tenant.id, body.resource_id, body.starts_at, body.ends_at);
      if (!r) return fail(404, "not_found", "No such resource.");
      if (tenant.kind === "sandbox" && bookingCount >= SANDBOX_LIMITS.bookings)
        return fail(
          403,
          "quota_exceeded",
          `A sandbox holds up to ${SANDBOX_LIMITS.bookings} bookings.`,
        );
      const verdict = canBook(
        body.starts_at,
        body.ends_at,
        r.timezone,
        r.slot_minutes,
        r.capacity,
        rules,
        busy,
      );
      if (!verdict.ok) {
        const message = {
          full: "That slot has no capacity left.",
          outside_hours: "The resource is not open then.",
          off_grid: `Bookings start and end on the resource's ${r.slot_minutes}-minute grid.`,
        }[verdict.reason];
        return fail(409, verdict.reason, message);
      }
      // The capacity check happens again here, inside the insert, against the live table.
      const saved = await d.insertIfRoom(
        {
          id: id("bkg"),
          tenant_id: tenant.id,
          resource_id: r.id,
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          status: body.hold ? "held" : "confirmed",
          hold_expires_at: body.hold
            ? iso(new Date(Date.now() + body.hold_minutes * 60_000))
            : null,
          customer_name: body.customer_name,
          customer_email: body.customer_email ?? null,
          notes: body.notes ?? null,
        },
        r.capacity,
      );
      if (!saved) return fail(409, "full", "That slot was taken a moment ago.");
      await emit(
        d,
        tenant.id,
        body.hold ? "booking.held" : "booking.confirmed",
        publicBooking(saved),
        (p) => c.executionCtx.waitUntil(p),
      );
      return { status: 201, body: publicBooking(saved) };
    });
    if (reply.replayed) c.header("Idempotent-Replayed", "true");
    if (reply.status >= 400)
      return c.json(reply.body as never, reply.status as 409, PROBLEM_HEADERS);
    return c.json(reply.body as never, reply.status as 201);
  },
);

bookings.openapi(
  createRoute({
    method: "get",
    path: "/bookings",
    tags,
    summary: "List bookings",
    description: "Newest start time first.",
    request: { query: PageQuery.extend({ resource_id: Id.optional() }) },
    responses: {
      200: {
        description: "A page of bookings",
        content: { "application/json": { schema: listOf(BookingSchema, "BookingList") } },
      },
      422: { description: "Invalid cursor", content: problemContent },
    },
  }),
  async (c) => {
    const { limit, cursor, resource_id } = c.req.valid("query");
    const after = cursor ? decodeCursor(cursor) : null;
    if (cursor && !after)
      return problem(c, 422, "invalid_cursor", "That cursor did not come from this list.");
    const rows = await c.get("db").bookings(c.get("tenant").id, resource_id ?? null, limit, after);
    const result = page(rows, limit, (b) => ({ sort: b.starts_at, id: b.id }));
    return c.json({ data: result.data.map(publicBooking), next_cursor: result.next_cursor }, 200);
  },
);

bookings.openapi(
  createRoute({
    method: "get",
    path: "/bookings/{id}",
    tags,
    summary: "Get a booking, with its payments",
    request: { params: z.object({ id: Id }) },
    responses: {
      200: {
        description: "The booking",
        content: {
          "application/json": {
            schema: BookingSchema.extend({
              payments: z.array(
                z.object({
                  id: z.string(),
                  provider_ref: z.string(),
                  amount_minor: z.number(),
                  currency: z.string(),
                  status: z.string(),
                  received_at: z.string(),
                }),
              ),
            }),
          },
        },
      },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const b = await d.booking(c.get("tenant").id, c.req.valid("param").id);
    if (!b) return problem(c, 404, "not_found", "No such booking.");
    return c.json({ ...publicBooking(b), payments: await d.payments(b.id) }, 200);
  },
);

bookings.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/confirm",
    tags,
    summary: "Confirm a hold",
    request: { params: z.object({ id: Id }) },
    responses: {
      200: { description: "Confirmed", content: { "application/json": { schema: BookingSchema } } },
      404: { description: "Not found", content: problemContent },
      409: {
        description: "Not a live hold",
        content: problemContent,
      },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const tenant = c.get("tenant");
    const b = await d.booking(tenant.id, c.req.valid("param").id);
    if (!b) return problem(c, 404, "not_found", "No such booking.");
    if (b.status === "confirmed") return c.json(publicBooking(b), 200);
    if (publicBooking(b).status !== "held") {
      return problem(
        c,
        409,
        "not_held",
        "Only a live hold can be confirmed; this one has expired or was cancelled.",
      );
    }
    const updated_at = await d.setStatus(b.id, "confirmed");
    const saved: Booking = { ...b, status: "confirmed", hold_expires_at: null, updated_at };
    await emit(d, tenant.id, "booking.confirmed", publicBooking(saved), (p) =>
      c.executionCtx.waitUntil(p),
    );
    return c.json(publicBooking(saved), 200);
  },
);

bookings.openapi(
  createRoute({
    method: "post",
    path: "/bookings/{id}/cancel",
    tags,
    summary: "Cancel a booking or a hold",
    request: { params: z.object({ id: Id }) },
    responses: {
      200: { description: "Cancelled", content: { "application/json": { schema: BookingSchema } } },
      404: { description: "Not found", content: problemContent },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const tenant = c.get("tenant");
    const b = await d.booking(tenant.id, c.req.valid("param").id);
    if (!b) return problem(c, 404, "not_found", "No such booking.");
    if (b.status !== "cancelled") {
      const updated_at = await d.setStatus(b.id, "cancelled");
      const saved: Booking = { ...b, status: "cancelled", hold_expires_at: null, updated_at };
      await emit(d, tenant.id, "booking.cancelled", publicBooking(saved), (p) =>
        c.executionCtx.waitUntil(p),
      );
      return c.json(publicBooking(saved), 200);
    }
    return c.json(publicBooking(b), 200);
  },
);
