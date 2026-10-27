import type { After } from "../page";
import { now, type Queryable, type BookingStatus, type Booking } from "./shared";

/** Bookings and the payments against them; capacity is enforced inside the insert. */
export function bookingsQueries(d1: Queryable) {
  return {
    booking: (tenantId: string, bookingId: string) =>
      d1
        .prepare("SELECT * FROM bookings WHERE tenant_id = ? AND id = ?")
        .bind(tenantId, bookingId)
        .first<Booking>(),

    /** Newest first by start time. */
    bookings: (tenantId: string, resourceId: string | null, limit: number, after: After | null) =>
      d1
        .prepare(
          `SELECT * FROM bookings WHERE tenant_id = ?1 AND (?2 IS NULL OR resource_id = ?2)
             AND (?3 IS NULL OR starts_at < ?3 OR (starts_at = ?3 AND id < ?4))
           ORDER BY starts_at DESC, id DESC LIMIT ?5`,
        )
        .bind(tenantId, resourceId, after?.sort ?? null, after?.id ?? null, limit + 1)
        .all<Booking>()
        .then((r) => r.results),

    /**
     * Insert a booking only if capacity is still there — one statement, so two requests for
     * the last place cannot both win. SQLite runs the subquery and the insert atomically.
     * Returns the row as stored, or null when the slot filled first.
     */
    insertIfRoom: async (
      b: Omit<Booking, "created_at" | "updated_at">,
      capacity: number,
    ): Promise<Booking | null> => {
      const t = now();
      const result = await d1
        .prepare(
          `INSERT INTO bookings (id, tenant_id, resource_id, starts_at, ends_at, status, hold_expires_at, customer_name, customer_email, notes, created_at, updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
           WHERE (
             SELECT COUNT(*) FROM bookings
             WHERE resource_id = ?3 AND starts_at < ?5 AND ends_at > ?4
               AND (status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?11))
           ) < ?12`,
        )
        .bind(
          b.id,
          b.tenant_id,
          b.resource_id,
          b.starts_at,
          b.ends_at,
          b.status,
          b.hold_expires_at,
          b.customer_name,
          b.customer_email,
          b.notes,
          t,
          capacity,
        )
        .run();
      return (result.meta.changes ?? 0) > 0 ? { ...b, created_at: t, updated_at: t } : null;
    },

    /** Returns the update time it wrote. */
    setStatus: async (bookingId: string, status: BookingStatus) => {
      const t = now();
      await d1
        .prepare(
          "UPDATE bookings SET status = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ?",
        )
        .bind(status, t, bookingId)
        .run();
      return t;
    },

    /** Holds past their expiry, which the cron turns into cancellations and events. */
    expiredHolds: () =>
      d1
        .prepare("SELECT * FROM bookings WHERE status = 'held' AND hold_expires_at <= ? LIMIT 100")
        .bind(now())
        .all<Booking>()
        .then((r) => r.results),

    /** The booking a payment event names, with the secret its tenant signs payments with. */
    bookingForPayment: (bookingId: string) =>
      d1
        .prepare(
          "SELECT b.*, t.payment_secret FROM bookings b JOIN tenants t ON t.id = b.tenant_id WHERE b.id = ?",
        )
        .bind(bookingId)
        .first<Booking & { payment_secret: string }>(),

    /** Records a payment; a second delivery of the same provider reference changes nothing. */
    recordPayment: async (p: {
      id: string;
      booking_id: string;
      provider_ref: string;
      amount_minor: number;
      currency: string;
      status: "succeeded" | "failed";
    }) => {
      const r = await d1
        .prepare(
          "INSERT OR IGNORE INTO payments (id, booking_id, provider_ref, amount_minor, currency, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(p.id, p.booking_id, p.provider_ref, p.amount_minor, p.currency, p.status, now())
        .run();
      return (r.meta.changes ?? 0) > 0;
    },

    payments: (bookingId: string) =>
      d1
        .prepare("SELECT * FROM payments WHERE booking_id = ? ORDER BY received_at")
        .bind(bookingId)
        .all<{
          id: string;
          provider_ref: string;
          amount_minor: number;
          currency: string;
          status: string;
          received_at: string;
        }>()
        .then((r) => r.results),
  };
}
