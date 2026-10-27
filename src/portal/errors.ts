import type { ProblemCode } from "../problem";

/**
 * What each problem `code` means and what to do about it. Every problem's `type` links to its
 * row on /docs/errors, and a test fails if a code is missing here, so no link lands nowhere.
 */
export const ERROR_DOCS: Record<ProblemCode, { status: number; when: string; fix: string }> = {
  unauthorized: {
    status: 401,
    when: "No `Authorization: Bearer` header, or a key the API has never issued.",
    fix: "Send the key from `POST /v1/sandbox` (or your live key) as a Bearer token.",
  },
  sandbox_expired: {
    status: 401,
    when: "The sandbox behind this key is more than a day old and has been deleted.",
    fix: "Create a new one with `POST /v1/sandbox`. Nothing carries over.",
  },
  rate_limited: {
    status: 429,
    when: "More than sixty requests in a minute on one key, or more than ten new sandboxes from one address.",
    fix: "Wait for the number of seconds in `Retry-After`, then retry.",
  },
  validation: {
    status: 422,
    when: "The body, query or path does not match the schema.",
    fix: "Read `errors`: one entry per field, each with a JSON Pointer to it and what was wrong.",
  },
  not_found: {
    status: 404,
    when: "No such route, or no such resource, booking or webhook for this tenant.",
    fix: "Check the id. Ids from another tenant are reported as not found, never as forbidden.",
  },
  invalid_timezone: {
    status: 422,
    when: "The time zone is not an IANA zone name the runtime knows.",
    fix: "Use a name like `Europe/Istanbul` or `America/New_York`, not an offset like `+03:00`.",
  },
  invalid_date: {
    status: 422,
    when: "A date is not a real calendar day, or `to` is before `from`.",
    fix: "Send dates as `YYYY-MM-DD`, local to the resource.",
  },
  range_too_long: {
    status: 422,
    when: "An availability request spans more than 31 days.",
    fix: "Ask for a month at a time and page by date.",
  },
  invalid_cursor: {
    status: 422,
    when: "The `cursor` was not a `next_cursor` this list returned.",
    fix: "Pass `next_cursor` back exactly as received; it is opaque.",
  },
  full: {
    status: 409,
    when: "The slot has no capacity left — or it filled between your availability check and your booking.",
    fix: "Fetch availability again and offer the next free slot.",
  },
  outside_hours: {
    status: 409,
    when: "The resource is not open for the whole of the requested time.",
    fix: "Book inside its weekly rules; `GET /v1/resources/{id}/rules` lists them.",
  },
  off_grid: {
    status: 409,
    when: "The booking does not start and end on the resource's slot grid.",
    fix: "Use `starts_at` and `ends_at` exactly as availability returns them.",
  },
  not_held: {
    status: 409,
    when: "Confirming a hold that expired or was cancelled.",
    fix: "Book the slot again; an expired hold has already released it.",
  },
  idempotency_mismatch: {
    status: 422,
    when: "An `Idempotency-Key` was reused with a different method, path or body.",
    fix: "Use a fresh key for every distinct request; reuse one only to retry the same request.",
  },
  idempotency_in_progress: {
    status: 409,
    when: "A retry arrived while the first request with the same key was still running.",
    fix: "Retry after a moment: you will get the first request's response.",
  },
  bad_signature: {
    status: 400,
    when: "The payment event's signature does not match its body, or its timestamp is more than five minutes old.",
    fix: "Sign `<timestamp>.<raw body>` with the tenant's payment secret and send it at once.",
  },
  quota_exceeded: {
    status: 403,
    when: "A sandbox reached one of its limits: 10 resources, 300 bookings, 3 webhook endpoints, 200 deliveries.",
    fix: "Delete what you no longer need, or start a new sandbox.",
  },
  sandbox_capacity: {
    status: 503,
    when: "Two thousand sandboxes are alive at once.",
    fix: "Retry after `Retry-After`; old sandboxes are deleted every five minutes.",
  },
  internal: {
    status: 500,
    when: "Something failed on the server.",
    fix: "Retry with the same `Idempotency-Key`. If it persists, report the `request_id`.",
  },
};
