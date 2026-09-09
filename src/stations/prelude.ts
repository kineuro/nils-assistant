// SPDX-License-Identifier: AGPL-3.0-only
// The general context a station carries into every turn (Wave 4c §9.11,
// as reworked for the local model): what the registry holds, rendered
// compactly from the engine's own catalog and guide, so the model reads
// the names that exist instead of paging for them. Fetched through the
// seam under the person's own token, once per epoch and subject, and
// cached in the process; never a row, never a value of a quasi-identifying
// field, only the catalog's own enumerations.

import type { Seam } from "../seam/client.ts";

interface Field {
  path: string;
  type: string;
  class: string;
  dated?: boolean;
  description?: string;
}
interface Level {
  level: string;
  fields: Field[];
}
export interface Catalog {
  epoch?: number;
  pack?: { name?: string; version?: string };
  grains?: { grain: string; key?: string; day?: string | null; carries?: string[] }[];
  edges?: { from: string; to: string; cardinality?: string; standing?: string[] }[];
  levels?: Level[];
  axes?: { name: string; multi?: boolean; values: { id: string; label?: string }[] }[];
  kinds?: {
    name: string;
    category?: string;
    value_type?: string | null;
    unit?: string | null;
    precision?: string;
  }[];
  diseases?: { name: string; courses?: string[] }[];
  namespaces?: string[];
  cohorts?: { name: string; owner?: string; members?: number }[];
  schemes?: { name: string; digest?: string; window_days?: number; anchor?: string }[];
  roles?: string[];
  pick_models?: string[];
  derived?: { name: string; grain: string; params?: [string, string][]; description?: string }[];
  presets?: { name: string; days: number }[];
  functions?: Record<string, string[]>;
  comparability_levels?: { name: string; description?: string }[];
}

export interface Guide {
  grounding?: string[];
  examples?: { question: string; document: unknown; note?: string }[];
  schema_digest?: string;
}

const HIDE = new Set(["id"]);

/** One level as one line per field, the technical ids left out, a quasi-identifying class marked. */
function renderLevel(l: Level): string {
  const fields = l.fields
    .filter((f) => !HIDE.has(f.path))
    .map(
      (f) =>
        `${f.path} (${f.type}${f.class === "quasi_identifying" ? ", quasi-identifying" : ""}${f.dated ? ", dated" : ""})`,
    )
    .join(", ");
  return `- ${l.level}: ${fields}`;
}

/** The catalog as text a small model reads once: grains and how they nest, the fields per level, the axes and their values, the kinds, the cohorts, the schemes, the derived fields, the functions. */
export function renderCatalog(c: Catalog): string {
  const out: string[] = [];
  out.push(`## The registry (pack ${c.pack?.name ?? "?"} ${c.pack?.version ?? ""}, epoch ${c.epoch ?? "?"})`);
  if (c.edges?.length) {
    out.push("Grains and how a set draws from another (`of`):");
    for (const e of c.edges)
      out.push(
        `- ${e.from} -> ${e.to}${e.cardinality ? ` (${e.cardinality})` : ""}${e.standing?.length ? `; standing: ${e.standing.join("; ")}` : ""}`,
      );
    out.push("Also `group` (rows grouped by clauses, with `bind` aggregates) and `pair`.");
  }
  if (c.levels?.length) {
    out.push(
      'Fields per level (`["field", {}, "<path>"]`; a parent\'s field is reached as `<parent>.<path>`, for example `subject.code` from a session or a stack, `session.first` from a stack):',
    );
    for (const l of c.levels) if (l.fields.length) out.push(renderLevel(l));
  }
  if (c.axes?.length) {
    out.push(
      'Axes of a stack (`["axis", {}, "<name>"]`; compare with `=`, or `has` for a multi-valued axis) and their values:',
    );
    for (const a of c.axes)
      out.push(
        `- ${a.name}${a.multi ? " (multi-valued, use has)" : ""}: ${a.values.map((v) => v.id).join(", ")}`,
      );
  }
  if (c.derived?.length) {
    out.push('Derived fields (`["derived", {}, "<name>"]`):');
    out.push(
      c.derived.map((d) => `${d.name} (${d.grain}${d.description ? `: ${d.description}` : ""})`).join("; "),
    );
  }
  if (c.kinds?.length) {
    out.push('Event kinds (`["=", {}, ["field", {}, "kind"], "<name>"]` on a set at grain event):');
    out.push(
      c.kinds
        .map((k) => `${k.name}${k.value_type ? ` (${k.value_type}${k.unit ? ` in ${k.unit}` : ""})` : ""}`)
        .join(", "),
    );
  }
  if (c.diseases?.length)
    out.push(
      `Diseases and courses: ${c.diseases.map((d) => `${d.name} [${(d.courses ?? []).join(", ")}]`).join("; ")}`,
    );
  if (c.cohorts?.length)
    out.push(
      `Cohorts (by name): ${c.cohorts.map((x) => `${x.name} (${x.members ?? "?"} members)`).join(", ")}`,
    );
  if (c.schemes?.length)
    out.push(`Session schemes: ${c.schemes.map((s) => s.name).join(", ")} (write \`scheme: default\`)`);
  if (c.roles?.length)
    out.push(
      `Roles a pick may name: ${c.roles.join(", ")}; pick models: ${(c.pick_models ?? []).join(", ")}`,
    );
  if (c.namespaces?.length) out.push(`Identifier namespaces: ${c.namespaces.join(", ")}`);
  if (c.presets?.length)
    out.push(`Window presets: ${c.presets.map((p) => `${p.name} = ${p.days} days`).join(", ")}`);
  if (c.functions) {
    out.push("Functions, by family:");
    for (const [family, names] of Object.entries(c.functions)) out.push(`- ${family}: ${names.join(", ")}`);
  }
  return out.join("\n");
}

/** The guide's grounding lines, as they are. */
export function renderGuide(g: Guide): string {
  const lines = (g.grounding ?? []).map((l) => `- ${l}`);
  return lines.length ? `## The engine's grounding\n${lines.join("\n")}` : "";
}

const cache = new Map<string, string>();
const catalogs = new Map<string, Catalog>();

/** The catalog the prelude fetched for a person, when it did; a tool answers an axis's values from it. */
export function catalogOf(key: string): Catalog | null {
  return catalogs.get(key) ?? null;
}

/** The prelude text already fetched for a person, when it was: a render reads it without a call, so it can sit in the instructions and stay the same across turns and conversations. */
export function preludeOf(key: string): string | null {
  return cache.get(key) ?? null;
}

/**
 * The prelude of one run: the catalog and the guide through the seam, cached
 * per epoch and person for the process's life. Two calls of the grant on
 * the first run of an epoch, none after.
 */
export async function prelude(
  seam: Seam,
  key: string,
  ctx: { toolCallId: string; phase: string },
): Promise<string> {
  const have = cache.get(key);
  if (have) return have;
  const [cat, guide] = await Promise.all([
    seam.call({
      method: "GET",
      path: "/api/ask/catalog",
      toolCallId: `${ctx.toolCallId}-catalog`,
      phase: ctx.phase,
    }),
    seam.call({
      method: "GET",
      path: "/api/ask/guide",
      toolCallId: `${ctx.toolCallId}-guide`,
      phase: ctx.phase,
    }),
  ]);
  const parts: string[] = [];
  if (cat.kind === "ok") parts.push(renderCatalog(cat.body as Catalog));
  if (guide.kind === "ok") parts.push(renderGuide(guide.body as Guide));
  const text = parts.join("\n\n");
  if (cat.kind === "ok") {
    cache.set(key, text);
    catalogs.set(key, cat.body as Catalog);
  }
  return text;
}

/** Warm the prelude for a person before their first turn, so the first render finds it; a failure is logged and the render falls back to a signal. */
export async function warmPrelude(seam: Seam, key: string): Promise<void> {
  if (cache.has(key)) return;
  try {
    await prelude(seam, key, { toolCallId: "prelude", phase: "resolve" });
  } catch (e) {
    console.error(`the prelude did not warm: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function forgetPrelude(): void {
  cache.clear();
  catalogs.clear();
}
