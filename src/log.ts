/**
 * One JSON object per line. Workers Logs indexes the fields, so "every 5xx for this tenant in
 * the last hour" is a filter rather than a grep.
 */
export function log(
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown> = {},
) {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
