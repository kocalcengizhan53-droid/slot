import { bookingsQueries } from "./db/bookings";
import { idempotencyQueries } from "./db/idempotency";
import { resourcesQueries } from "./db/resources";
import type { Queryable } from "./db/shared";
import { tenantsQueries } from "./db/tenants";
import { webhooksQueries } from "./db/webhooks";

/**
 * The database, as typed functions.
 *
 * Every query the API runs lives here with its row type beside it, so a route never writes
 * SQL and a change to a table has one place to go. Instants are ISO UTC strings throughout;
 * SQLite compares them as text, which for this format is the same as comparing time.
 *
 * Requests run on a D1 session: reads go to the nearest replica that has caught up with
 * everything this client has written (the bookmark travels in a header), writes go to the
 * primary. Where a route needs several reads, they go in one batch — one round trip.
 */
export * from "./db/shared";

/** Every query, by domain in src/db/, behind one object: a route asks db(c.env.DB) for what it needs. */
export function db(d1: Queryable) {
  return {
    ...tenantsQueries(d1),
    ...resourcesQueries(d1),
    ...bookingsQueries(d1),
    ...idempotencyQueries(d1),
    ...webhooksQueries(d1),
  };
}

export type Db = ReturnType<typeof db>;
