import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

import { verifySignature } from "../auth";
import { db, id } from "../db";
import { emit } from "../events";
import { ErrorBody, PaymentEvent } from "../schemas";

/**
 * The payment provider calls this, not the tenant, so there is no API key — the body is
 * signed with the tenant's payment secret instead, the way Stripe and the others do it. A
 * successful payment confirms the booking it names. The provider's reference is unique, so
 * the same event delivered twice — which providers do — confirms once and says so.
 */
export const payments = new OpenAPIHono<{ Bindings: Env }>();

payments.openapi(
  createRoute({
    method: "post",
    path: "/payments/webhook",
    tags: ["Payments"],
    summary: "Payment provider webhook (signed, idempotent)",
    description:
      'Signed with the tenant\'s payment secret: `X-Provider-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`. Replays of the same `provider_ref` are acknowledged and change nothing.',
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
      400: { description: "Bad signature", content: { "application/json": { schema: ErrorBody } } },
      404: {
        description: "No such booking",
        content: { "application/json": { schema: ErrorBody } },
      },
    },
  }),
  async (c) => {
    const raw = await c.req.text();
    const event = c.req.valid("json");
    const d = db(c.env.DB);
    // The booking tells us the tenant, and the tenant tells us the secret to check against.
    const booking = await c.env.DB.prepare(
      "SELECT b.*, t.payment_secret FROM bookings b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = ?",
    )
      .bind(event.booking_id)
      .first<{ id: string; tenant_id: string; status: string; payment_secret: string }>();
    if (!booking) return c.json({ error: { code: "not_found", message: "No such booking." } }, 404);
    if (
      !(await verifySignature(booking.payment_secret, c.req.header("x-provider-signature"), raw))
    ) {
      return c.json(
        {
          error: {
            code: "bad_signature",
            message: "The signature does not match the body, or is too old.",
          },
        },
        400,
      );
    }
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
      await d.setStatus(booking.id, "confirmed");
      status = "confirmed";
      const saved = (await d.booking(booking.tenant_id, booking.id))!;
      await emit(
        d,
        booking.tenant_id,
        "payment.received",
        { booking: saved, payment: event },
        (p) => c.executionCtx.waitUntil(p),
      );
      await emit(d, booking.tenant_id, "booking.confirmed", saved, (p) =>
        c.executionCtx.waitUntil(p),
      );
    }
    return c.json({ received: true, applied, booking_status: status }, 200);
  },
);
