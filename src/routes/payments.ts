import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { verifySignature, type AppEnv } from "../auth";
import { id, type Booking } from "../db";
import { emit } from "../events";
import { problem, problemContent } from "../problem";
import { PaymentEvent } from "../schemas";

export const payments = new OpenAPIHono<AppEnv>();

payments.openapi(
  createRoute({
    method: "post",
    path: "/payments/webhook",
    tags: ["Payments"],
    summary: "Payment provider webhook (signed, idempotent)",
    description:
      'Signed with the tenant\'s payment secret: `X-Provider-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. Replays of the same `provider_ref` are acknowledged and change nothing. No API key: the signature is the authentication.',
    security: [],
    request: {
      headers: z.object({ "x-provider-signature": z.string().optional() }),
      body: { content: { "application/json": { schema: PaymentEvent } } },
    },
    responses: {
      200: {
        description: "Acknowledged",
        content: {
          "application/json": {
            schema: z.object({
              received: z.boolean(),
              applied: z.boolean(),
              booking_status: z.string(),
            }),
          },
        },
      },
      400: { description: "Bad signature", content: problemContent },
      404: { description: "No such booking", content: problemContent },
    },
  }),
  async (c) => {
    const raw = await c.req.text();
    const event = c.req.valid("json");
    const d = c.get("db");
    // The booking tells us the tenant, and the tenant tells us the secret to check against.
    const found = await d.bookingForPayment(event.booking_id);
    if (!found) return problem(c, 404, "not_found", "No such booking.");
    const { payment_secret, ...booking } = found;
    if (!(await verifySignature(payment_secret, c.req.header("x-provider-signature"), raw)))
      return problem(
        c,
        400,
        "bad_signature",
        "The signature does not match the body, or is too old.",
      );
    const applied = await d.recordPayment({
      id: id("pay"),
      booking_id: booking.id,
      provider_ref: event.provider_ref,
      amount_minor: event.amount_minor,
      currency: event.currency,
      status: event.status,
    });
    let status = booking.status;
    if (applied && event.status === "succeeded" && booking.status !== "cancelled") {
      const updated_at = await d.setStatus(booking.id, "confirmed");
      status = "confirmed";
      const { tenant_id: _t, ...saved } = {
        ...booking,
        status,
        hold_expires_at: null,
        updated_at,
      } as Booking;
      void _t;
      const waitUntil = (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
      await emit(
        d,
        booking.tenant_id,
        "payment.received",
        { booking: saved, payment: event },
        waitUntil,
      );
      await emit(d, booking.tenant_id, "booking.confirmed", saved, waitUntil);
    }
    return c.json({ received: true, applied, booking_status: status }, 200);
  },
);
