import { iso } from "../lib/time";

export type Tenant = {
  id: string;
  name: string;
  api_key_hash: string;
  payment_secret: string;
  kind: "live" | "sandbox";
  expires_at: string | null;
  created_at: string;
};
export type Resource = {
  id: string;
  tenant_id: string;
  name: string;
  timezone: string;
  slot_minutes: number;
  capacity: number;
  created_at: string;
};
export type Rule = {
  id: string;
  resource_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
};
export type BookingStatus = "held" | "confirmed" | "cancelled";
export type Booking = {
  id: string;
  tenant_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  hold_expires_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};
export type Webhook = {
  id: string;
  tenant_id: string;
  url: string;
  secret: string;
  events: string;
  active: number;
  created_at: string;
};
export type Delivery = {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  attempts: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
};

export const now = () => iso(new Date());
export const id = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A database or a session on one: both prepare and batch. */
export type Queryable = Pick<D1Database, "prepare" | "batch">;

/** Bookings that take capacity: confirmed, or held and not yet expired. */
export const LIVE = "(status = 'confirmed' OR (status = 'held' AND hold_expires_at > ?))";
