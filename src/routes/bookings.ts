import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { idempotent, type AppEnv } from "../auth";
import { id, type Booking } from "../db";
import { emit } from "../events";
import { canBook } from "../lib/slots";
import { iso } from "../lib/time";
import { BookingSchema, ErrorBody, Id, NewBooking } from "../schemas";

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
        content: { "application/json": { schema: ErrorBody } },
      },
      409: {
        description: "Cannot be booked: full, outside hours, or off the slot grid",
        content: { "application/json": { schema: ErrorBody } },
      },
      422: {
        description: "Idempotency-Key reused with a different request",
        content: { "application/json": { schema: ErrorBody } },
      },
    },
  }),
  async (c) => {
    const body = c.req.valid("json");
    const d = c.get("db");
    const tenant = c.get("tenant");
    const reply = await idempotent(c, async () => {
      const r = await d.resource(tenant.id, body.resource_id);
      if (!r)
        return {
          status: 404,
          body: { error: { code: "not_found", message: "No such resource." } },
        };
      if (body.ends_at <= body.starts_at) {
        return {
          status: 409,
          body: { error: { code: "off_grid", message: "ends_at must be after starts_at." } },
        };
      }
      const rules = await d.rules(r.id);
      const busy = await d.busy(r.id, body.starts_at, body.ends_at);
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
        return { status: 409, body: { error: { code: verdict.reason, message } } };
      }
      const booking: Omit<Booking, "created_at" | "updated_at"> = {
        id: id("bkg"),
        tenant_id: tenant.id,
        resource_id: r.id,
        starts_at: body.starts_at,
        ends_at: body.ends_at,
        status: body.hold ? "held" : "confirmed",
        hold_expires_at: body.hold ? iso(new Date(Date.now() + body.hold_minutes * 60_000)) : null,
        customer_name: body.customer_name,
        customer_email: body.customer_email ?? null,
        notes: body.notes ?? null,
      };
      // The capacity check happens again here, inside the insert, against the live table.
      const inserted = await d.insertIfRoom(booking, r.capacity);
      if (!inserted)
        return {
          status: 409,
          body: { error: { code: "full", message: "That slot was taken a moment ago." } },
        };
      const saved = (await d.booking(tenant.id, booking.id))!;
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
    return c.json(reply.body as never, reply.status as 201);
  },
);

bookings.openapi(
  createRoute({
    method: "get",
    path: "/bookings",
    tags,
    summary: "List bookings",
    request: { query: z.object({ resource_id: Id.optional() }) },
    responses: {
      200: {
        description: "Most recent first, up to 200",
        content: { "application/json": { schema: z.array(BookingSchema) } },
      },
    },
  }),
  async (c) => {
    const list = await c.get("db").bookings(c.get("tenant").id, c.req.valid("query").resource_id);
    return c.json(list.map(publicBooking), 200);
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const b = await d.booking(c.get("tenant").id, c.req.valid("param").id);
    if (!b) return c.json({ error: { code: "not_found", message: "No such booking." } }, 404);
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
      409: {
        description: "Not a live hold",
        content: { "application/json": { schema: ErrorBody } },
      },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const tenant = c.get("tenant");
    const b = await d.booking(tenant.id, c.req.valid("param").id);
    if (!b) return c.json({ error: { code: "not_found", message: "No such booking." } }, 404);
    if (b.status === "confirmed") return c.json(publicBooking(b), 200);
    if (publicBooking(b).status !== "held") {
      return c.json(
        {
          error: {
            code: "not_held",
            message: "Only a live hold can be confirmed; this one has expired or was cancelled.",
          },
        },
        409,
      );
    }
    await d.setStatus(b.id, "confirmed");
    const saved = (await d.booking(tenant.id, b.id))!;
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
      404: { description: "Not found", content: { "application/json": { schema: ErrorBody } } },
    },
  }),
  async (c) => {
    const d = c.get("db");
    const tenant = c.get("tenant");
    const b = await d.booking(tenant.id, c.req.valid("param").id);
    if (!b) return c.json({ error: { code: "not_found", message: "No such booking." } }, 404);
    if (b.status !== "cancelled") {
      await d.setStatus(b.id, "cancelled");
      const saved = (await d.booking(tenant.id, b.id))!;
      await emit(d, tenant.id, "booking.cancelled", publicBooking(saved), (p) =>
        c.executionCtx.waitUntil(p),
      );
      return c.json(publicBooking(saved), 200);
    }
    return c.json(publicBooking(b), 200);
  },
);
