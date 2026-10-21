import { z } from "@hono/zod-openapi";

/**
 * The shapes on the wire, once, with the examples the docs show. Every route reads and
 * writes these, so the OpenAPI document and the validation are the same object.
 */

export const Id = z.string().min(1).openapi({ example: "res_room_a" });
export const Instant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    "an ISO 8601 instant in UTC, to the second, ending in Z",
  )
  .openapi({ example: "2026-10-23T07:00:00Z", description: "ISO 8601, UTC, seconds, Z" });
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: "2026-10-23" });

export const ErrorBody = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "full" }),
      message: z.string().openapi({ example: "That slot has no capacity left." }),
    }),
  })
  .openapi("Error");

export const ResourceSchema = z
  .object({
    id: Id,
    name: z.string().openapi({ example: "Room A — recording" }),
    timezone: z
      .string()
      .openapi({
        example: "Europe/Istanbul",
        description: "IANA zone the availability rules are written in",
      }),
    slot_minutes: z.number().int().openapi({ example: 60 }),
    capacity: z
      .number()
      .int()
      .openapi({
        example: 1,
        description: "Bookings that may overlap. A room is 1; a class with ten places is 10.",
      }),
    created_at: Instant,
  })
  .openapi("Resource");

export const NewResource = z
  .object({
    name: z.string().min(1).max(120),
    timezone: z.string().min(1),
    slot_minutes: z.number().int().min(5).max(720).default(30),
    capacity: z.number().int().min(1).max(1000).default(1),
  })
  .openapi("NewResource");

export const RuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6).openapi({ example: 1, description: "0 = Sunday" }),
    start_minute: z
      .number()
      .int()
      .min(0)
      .max(1440)
      .openapi({ example: 540, description: "Minutes from local midnight" }),
    end_minute: z.number().int().min(0).max(1440).openapi({ example: 1080 }),
  })
  .refine((r) => r.end_minute > r.start_minute, {
    message: "end_minute must be after start_minute",
  })
  .openapi("Rule");

export const SlotSchema = z
  .object({
    starts_at: Instant,
    ends_at: Instant,
    local: z.string().openapi({ example: "2026-10-23T09:00" }),
    available: z.number().int().openapi({ example: 1 }),
  })
  .openapi("Slot");

export const AvailabilitySchema = z
  .object({
    resource_id: Id,
    timezone: z.string(),
    slot_minutes: z.number().int(),
    days: z.array(z.object({ date: LocalDate, slots: z.array(SlotSchema) })),
  })
  .openapi("Availability");

export const BookingStatus = z.enum(["held", "confirmed", "cancelled"]);

export const BookingSchema = z
  .object({
    id: Id.openapi({ example: "bkg_1f3a9c2e7b0d4a5e6f12" }),
    resource_id: Id,
    starts_at: Instant,
    ends_at: Instant,
    status: BookingStatus,
    hold_expires_at: Instant.nullable(),
    customer_name: z.string().nullable(),
    customer_email: z.string().nullable(),
    notes: z.string().nullable(),
    created_at: Instant,
    updated_at: Instant,
  })
  .openapi("Booking");

export const NewBooking = z
  .object({
    resource_id: Id,
    starts_at: Instant,
    ends_at: Instant,
    customer_name: z.string().min(1).max(120).openapi({ example: "Deniz Aksoy" }),
    customer_email: z.string().email().optional().openapi({ example: "deniz@example.com" }),
    notes: z.string().max(500).optional(),
    hold: z
      .boolean()
      .default(false)
      .openapi({
        description: "Hold the slot instead of confirming it. A hold expires unless confirmed.",
      }),
    hold_minutes: z.number().int().min(1).max(60).default(10),
  })
  .openapi("NewBooking");

export const PaymentEvent = z
  .object({
    provider_ref: z
      .string()
      .min(1)
      .openapi({
        example: "pay_7Qx9k2",
        description: "The provider's own id; a replay with the same ref changes nothing",
      }),
    booking_id: Id,
    amount_minor: z.number().int().min(0).openapi({ example: 12000 }),
    currency: z.string().length(3).openapi({ example: "GBP" }),
    status: z.enum(["succeeded", "failed"]),
  })
  .openapi("PaymentEvent");

export const WebhookSchema = z
  .object({
    id: Id.openapi({ example: "whk_8a1c" }),
    url: z.string().url(),
    events: z.array(z.string()).openapi({ example: ["booking.confirmed", "booking.cancelled"] }),
    active: z.boolean(),
    created_at: Instant,
  })
  .openapi("Webhook");

export const NewWebhook = z
  .object({
    url: z.string().url().openapi({ example: "https://example.com/hooks/slot" }),
    events: z.array(z.string()).min(1).default(["*"]),
  })
  .openapi("NewWebhook");

export const DeliverySchema = z
  .object({
    id: Id,
    webhook_id: Id,
    event: z.string(),
    attempts: z.number().int(),
    delivered_at: Instant.nullable(),
    next_attempt_at: Instant.nullable(),
    last_status: z.number().int().nullable(),
    last_error: z.string().nullable(),
    created_at: Instant,
  })
  .openapi("Delivery");
