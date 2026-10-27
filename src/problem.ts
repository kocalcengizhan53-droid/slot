import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Errors as RFC 9457 problem details, so a client can branch on one stable field (`code`)
 * and a person can follow `type` to the page that explains it. Every problem carries the
 * request id that is also in the `X-Request-Id` header and in the log line for the request.
 */

const TITLES = {
  unauthorized: "Missing or unknown API key",
  sandbox_expired: "Sandbox expired",
  rate_limited: "Too many requests",
  validation: "The request does not match the schema",
  not_found: "Not found",
  invalid_timezone: "Unknown time zone",
  invalid_date: "Invalid date",
  range_too_long: "Range too long",
  invalid_cursor: "Invalid cursor",
  full: "No capacity left",
  outside_hours: "Outside opening hours",
  off_grid: "Off the slot grid",
  not_held: "Not a live hold",
  idempotency_mismatch: "Idempotency-Key reused with a different request",
  idempotency_in_progress: "A request with this Idempotency-Key is still running",
  bad_signature: "Bad signature",
  quota_exceeded: "Sandbox quota reached",
  sandbox_capacity: "No sandboxes free",
  internal: "Internal error",
} as const;

export type ProblemCode = keyof typeof TITLES;
export const PROBLEM_CODES = Object.keys(TITLES) as ProblemCode[];
export const problemTitle = (code: ProblemCode) => TITLES[code];

export const ProblemSchema = z
  .object({
    type: z
      .string()
      .openapi({ example: "https://slot.kocalcengizhan.workers.dev/docs/errors#full" }),
    title: z.string().openapi({ example: "No capacity left" }),
    status: z.number().int().openapi({ example: 409 }),
    detail: z.string().openapi({ example: "That slot has no capacity left." }),
    instance: z.string().openapi({ example: "/v1/bookings" }),
    code: z.string().openapi({ example: "full", description: "Stable; branch on this" }),
    request_id: z.string().openapi({ example: "req_3f9a1c2e7b0d4a5e" }),
    errors: z
      .array(z.object({ pointer: z.string(), detail: z.string() }))
      .optional()
      .openapi({ description: "Validation only: one entry per field, as a JSON Pointer" }),
  })
  .openapi("Problem");

export type ProblemBody = z.infer<typeof ProblemSchema>;

/** The content block every route declares for its error responses. */
export const problemContent = { "application/problem+json": { schema: ProblemSchema } };

export function problemBody(
  c: Context,
  status: number,
  code: ProblemCode,
  detail: string,
  errors?: { pointer: string; detail: string }[],
): ProblemBody {
  return {
    type: `${new URL(c.req.url).origin}/docs/errors#${code}`,
    title: TITLES[code],
    status,
    detail,
    instance: c.req.path,
    code,
    request_id: (c.get("requestId") as string | undefined) ?? "",
    ...(errors ? { errors } : {}),
  };
}

export const PROBLEM_HEADERS = { "content-type": "application/problem+json" };

export function problem<S extends ContentfulStatusCode>(
  c: Context,
  status: S,
  code: ProblemCode,
  detail: string,
  errors?: { pointer: string; detail: string }[],
) {
  return c.json(problemBody(c, status, code, detail, errors), status, PROBLEM_HEADERS);
}
