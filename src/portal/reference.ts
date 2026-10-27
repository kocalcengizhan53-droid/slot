import { esc, inline } from "./html";
import { OPERATION_SPECS, codePanel } from "./snippets";

/**
 * The API reference, rendered from the OpenAPI document the routes generate. Nothing here is
 * written by hand per endpoint except the example request, so a field added to a schema shows
 * up in the reference on the next deploy, and one that is removed disappears.
 */

type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  description?: string;
  example?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
};
type Param = {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
  description?: string;
};
type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Param[];
  security?: unknown[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: Schema }> }
  >;
};
export type OpenApiDoc = {
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
};

const METHODS = ["get", "post", "put", "delete"];

export const slug = (method: string, path: string) =>
  `${method}${path.replace(/[{}]/g, "").replace(/[^a-z0-9]+/gi, "-")}`
    .toLowerCase()
    .replace(/-+$/, "");

export function operations(doc: OpenApiDoc) {
  const order = (doc.tags ?? []).map((t) => t.name);
  const all = Object.entries(doc.paths ?? {}).flatMap(([path, ops]) =>
    METHODS.filter((m) => ops[m]).map((method) => ({ method, path, op: ops[method] })),
  );
  return order.map((tag) => ({
    tag,
    description: doc.tags?.find((t) => t.name === tag)?.description ?? "",
    ops: all.filter((o) => o.op.tags?.[0] === tag),
  }));
}

function resolve(doc: OpenApiDoc, s: Schema | undefined): Schema {
  if (!s) return {};
  if (s.$ref) return resolve(doc, doc.components?.schemas?.[s.$ref.split("/").pop()!]);
  return s;
}

function typeOf(doc: OpenApiDoc, s: Schema | undefined): string {
  if (!s) return "any";
  if (s.$ref) return s.$ref.split("/").pop()!;
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  const alts = s.anyOf ?? s.oneOf;
  if (alts) return alts.map((a) => typeOf(doc, a)).join(" | ");
  if (Array.isArray(s.type))
    return s.type.map((t) => (t === "array" ? `${typeOf(doc, s.items)}[]` : t)).join(" | ");
  if (s.type === "array") return `${typeOf(doc, s.items)}[]`;
  if (s.type === "integer" || s.type === "number") return s.type;
  return s.type ?? "object";
}

function constraints(s: Schema) {
  const out: string[] = [];
  if (s.minimum !== undefined && s.maximum !== undefined) out.push(`${s.minimum}–${s.maximum}`);
  else if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`);
  else if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`);
  if (s.maxLength !== undefined) out.push(`up to ${s.maxLength} chars`);
  if (s.maxItems !== undefined) out.push(`up to ${s.maxItems} items`);
  if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`);
  if (s.format === "email") out.push("email");
  return out;
}

function fieldRow(doc: OpenApiDoc, name: string, s: Schema, required: boolean) {
  const r = resolve(doc, s);
  const notes = [...constraints(r)];
  const example =
    r.example !== undefined && typeof r.example !== "object"
      ? `e.g. <code>${esc(JSON.stringify(r.example))}</code>`
      : "";
  const desc = [
    r.description ? inline(r.description) : "",
    notes.length ? esc(notes.join(" · ")) : "",
    example,
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="field"><div class="nm">${esc(name)} <span class="ty">${esc(typeOf(doc, s))}</span>${required ? '<span class="rq">required</span>' : ""}</div>${desc ? `<p>${desc}</p>` : ""}</div>`;
}

function fieldsOf(doc: OpenApiDoc, schema: Schema | undefined, title: string, prefix = "") {
  const s = resolve(doc, schema);
  if (s.type === "array" && s.items) {
    return fieldsOf(doc, s.items, `${title} (an array of these)`, prefix);
  }
  const props = Object.entries(s.properties ?? {});
  if (!props.length) return "";
  const rows = props.flatMap(([name, p]) => {
    const row = fieldRow(doc, `${prefix}${name}`, p, (s.required ?? []).includes(name));
    // One level into a list envelope's items, so `data[].status` is documented where it is returned.
    const inner = resolve(doc, p);
    if (!prefix && inner.type === "array" && inner.items && resolve(doc, inner.items).properties) {
      const item = resolve(doc, inner.items);
      return [
        row,
        ...Object.entries(item.properties ?? {}).map(([n, q]) =>
          fieldRow(doc, `${name}[].${n}`, q, (item.required ?? []).includes(n)),
        ),
      ];
    }
    return [row];
  });
  return `<div class="fields"><h4>${esc(title)}</h4>${rows.join("")}</div>`;
}

function paramsOf(doc: OpenApiDoc, params: Param[] = []) {
  const shown = params.filter((p) => p.in !== "header" || p.name.toLowerCase() !== "authorization");
  if (!shown.length) return "";
  const rows = shown.map((p) =>
    fieldRow(
      doc,
      p.in === "header" ? p.name : p.name,
      { ...(p.schema ?? {}), description: p.description ?? p.schema?.description },
      Boolean(p.required),
    ).replace('<span class="ty">', `<span class="ty">${p.in} · `),
  );
  return `<div class="fields"><h4>Parameters</h4>${rows.join("")}</div>`;
}

export function referenceBody(doc: OpenApiDoc, origin: string) {
  const groups = operations(doc);
  const side = groups
    .map(
      (g) =>
        `<div><h4>${esc(g.tag)}</h4>${g.ops
          .map(
            (o) =>
              `<a href="#${slug(o.method, o.path)}"><span class="m ${o.method}">${o.method.toUpperCase()}</span>${esc(o.op.summary ?? o.path)}</a>`,
          )
          .join("")}</div>`,
    )
    .join("");

  const sections = groups
    .map((g) => {
      const ops = g.ops
        .map((o) => {
          const key = `${o.method.toUpperCase()} ${o.path}`;
          const id = slug(o.method, o.path);
          const spec = OPERATION_SPECS[key];
          const body = o.op.requestBody?.content?.["application/json"]?.schema;
          const ok = Object.entries(o.op.responses ?? {}).find(([code]) => code.startsWith("2"));
          const okSchema = ok?.[1].content?.["application/json"]?.schema;
          const responses = Object.entries(o.op.responses ?? {})
            .map(
              ([code, r]) =>
                `<div><span class="badge s${code[0]}">${esc(code)}</span><span>${inline(r.description ?? "")}</span></div>`,
            )
            .join("");
          const open = Array.isArray(o.op.security) && o.op.security.length === 0;
          return `<article class="op" id="${id}" aria-labelledby="${id}-title">
  <div class="op-head">
    <h3 id="${id}-title">${esc(o.op.summary ?? key)}</h3>
    <div class="op-path"><span class="m ${o.method}">${o.method.toUpperCase()}</span><code>${esc(o.path)}</code>${open ? '<span class="pill">no key</span>' : ""}</div>
    <span class="lat-badge" data-op="${esc(key)}">live server time <b>—</b></span>
  </div>
  <div class="op-grid">
    <div style="display:grid;gap:14px;min-width:0">
      ${o.op.description ? `<p class="op-desc">${inline(o.op.description)}</p>` : ""}
      ${paramsOf(doc, o.op.parameters)}
      ${body ? fieldsOf(doc, body, "Body") : ""}
      <div class="responses" aria-label="Responses">${responses}</div>
      ${okSchema ? `<details><summary class="muted small" style="cursor:pointer">Response fields</summary><div style="margin-top:10px">${fieldsOf(doc, okSchema, "Response")}</div></details>` : ""}
    </div>
    ${spec ? codePanel(spec, origin, { id: `run-${id}`, label: o.op.summary ?? key }) : ""}
  </div>
</article>`;
        })
        .join("");
      return `<section aria-labelledby="tag-${g.tag.toLowerCase()}" style="display:grid;gap:8px"><h2 id="tag-${g.tag.toLowerCase()}">${esc(g.tag)}</h2><p class="muted">${esc(g.description)}</p>${ops}</section>`;
    })
    .join("");

  return `<div class="wrap docs">
  <aside class="side" aria-label="Endpoints">
    <details open><summary>Endpoints</summary><div class="side-groups">${side}</div></details>
  </aside>
  <div class="doc">
    <div class="doc-head">
      <span class="eyebrow">Reference · OpenAPI 3.1</span>
      <h1 style="font-size:clamp(2rem,4vw,2.8rem)">API reference</h1>
      <p class="lede">Every endpoint, generated from the same schemas that validate requests. Each one has a request you can run against your sandbox, and the server time it has taken on real traffic over the last day.</p>
      <div class="keychip" data-keychip><span>Base URL</span><code>${esc(origin)}/v1</code><span class="muted">·</span><span data-key-status>No sandbox yet — the first Run creates one.</span></div>
    </div>
    ${sections}
  </div>
</div>`;
}
