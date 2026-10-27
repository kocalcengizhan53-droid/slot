import { z } from "@hono/zod-openapi";

/**
 * Cursor pagination. A cursor is the sort key and id of the last item a page returned,
 * base64url-encoded so clients treat it as opaque; the next page starts strictly after it.
 * Unlike an offset, it does not skip or repeat items when rows are added between requests.
 */

export const PageQuery = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .openapi({ example: 20, description: "Items per page" }),
  cursor: z
    .string()
    .max(300)
    .optional()
    .openapi({ description: "`next_cursor` from the previous page" }),
});

export type After = { sort: string; id: string };

export function encodeCursor(after: After): string {
  return btoa(JSON.stringify([after.sort, after.id]))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function decodeCursor(cursor: string): After | null {
  try {
    const parsed: unknown = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    )
      return { sort: parsed[0], id: parsed[1] };
  } catch {
    // fall through
  }
  return null;
}

/** The list envelope every collection returns. */
export const listOf = <T extends z.ZodType>(item: T, name: string) =>
  z
    .object({
      data: z.array(item),
      next_cursor: z
        .string()
        .nullable()
        .openapi({ description: "Pass as `cursor` for the next page; null on the last" }),
    })
    .openapi(name);

/** Rows were fetched with limit + 1; trims the extra one and turns it into a cursor. */
export function page<T>(rows: T[], limit: number, key: (row: T) => After) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, next_cursor: more ? encodeCursor(key(data[data.length - 1])) : null };
}
