// SPDX-License-Identifier: AGPL-3.0-only
// The columns an answer holds as shapes (record 55 K7, 2026-10-12). Below
// detail quasi the engine answers a column that reads a quasi identifying
// field as its shape (digits as 9, letters as a or A, the rest kept) and
// names those columns in `shaped`: on a run, fresh and cached, on the
// preview, on a handle and its pages, and in a queued job's result; a
// handle's columns carry `shaped: true` as well. Every reader that hands an
// answer's rows to a model passes the names on as one plain line, so a shape
// is never read as a value: a plain reader was once told "ages 21 to 61",
// which the model had made up.

import type { JsonValue } from "@flue/runtime";

/**
 * The columns an engine answer names as shapes, in order and once each: its `shaped` list and its columns marked
 * `shaped: true`. Null when it names neither, as an engine from before 2026-10-12 answers.
 */
export function shapedOf(body: unknown): string[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as { shaped?: unknown; columns?: unknown };
  const listed = Array.isArray(b.shaped) ? b.shaped.filter((x): x is string => typeof x === "string") : null;
  const marked = (Array.isArray(b.columns) ? b.columns : []).flatMap((c) => {
    const col = (c ?? {}) as { name?: unknown; shaped?: unknown };
    return col.shaped === true && typeof col.name === "string" ? [col.name] : [];
  });
  if (listed === null && marked.length === 0) return null;
  return [...new Set([...(listed ?? []), ...marked])];
}

/** The one plain line a model reads of the columns an answer holds as shapes; null when there are none. */
export function shapedLine(columns: readonly string[]): string | null {
  return columns.length
    ? `These columns came back as shapes at your detail: ${columns.join(", ")}; their values are not known to you.`
    : null;
}

/** A column of an answer with values held back, and why (record 55 K7, the ruling on aggregates of 2026-10-12). */
export interface HeldBack {
  column: string;
  why: string;
}

/**
 * The columns an engine answer names with values held back, in order and once each: its `held_back` list
 * ([{column, why}]) and its columns marked `held_back: <why>`. At detail plain a group's mean, spread or count of
 * distinct values of a quasi identifying field (an age) is null where the group holds fewer than 5 subjects with a
 * value. Null when the answer names neither, as an engine from before then answers.
 */
export function heldBackOf(body: unknown): HeldBack[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as { held_back?: unknown; columns?: unknown };
  const out = new Map<string, string>();
  const listed = Array.isArray(b.held_back);
  for (const h of listed ? (b.held_back as unknown[]) : []) {
    const x = (h ?? {}) as { column?: unknown; why?: unknown };
    if (typeof x.column === "string" && !out.has(x.column))
      out.set(x.column, typeof x.why === "string" && x.why.trim() ? x.why.trim() : "held back");
  }
  for (const c of Array.isArray(b.columns) ? b.columns : []) {
    const col = (c ?? {}) as { name?: unknown; held_back?: unknown };
    if (typeof col.name === "string" && typeof col.held_back === "string" && !out.has(col.name))
      out.set(col.name, col.held_back);
  }
  if (!listed && out.size === 0) return null;
  return [...out].map(([column, why]) => ({ column, why }));
}

/** The one plain line a model reads of the values an answer held back; null when there are none. */
export function heldBackLine(held: readonly HeldBack[]): string | null {
  if (!held.length) return null;
  // a count held back is written as held in the rows a model reads, never as a null it would read as none
  const counts = held.some((h) => /^fewer than 5\b/iu.test(h.why));
  return `Some values of these columns were held back at your detail and are null in the rows${counts ? ` (a count, "${HELD_COUNT}")` : ""}: ${held.map((h) => `${h.column} (${h.why})`).join(", ")}. Never state, compute or guess a held-back value${counts ? ', never say a held count as 0, none or "fewer than 5", and never work one out from a total or the counts around it' : ""}; say which values were held back and why.`;
}

/**
 * A tool's answer with those lines as its `shaped` and `held_back`, in place of the engine's lists, which the lines
 * hold; unchanged when the answer holds nothing as shapes or held back, or is not an object.
 */
export function withShapedLine(output: JsonValue, body: unknown): JsonValue {
  const line = shapedLine(shapedOf(body) ?? []);
  const heldBack = heldBackOf(body) ?? [];
  const held = heldBackLine(heldBack);
  if ((!line && !held) || !output || typeof output !== "object" || Array.isArray(output)) return output;
  // the rows a model reads write a held count as held (record 55 K7, small counts)
  const o = output as Record<string, JsonValue>;
  const columns = Array.isArray(o.columns)
    ? o.columns.map((c) => (isRecord(c) ? String(c.name ?? "") : String(c)))
    : null;
  const out: Record<string, JsonValue> = { ...o };
  if (columns && Array.isArray(o.rows))
    out.rows = heldCountCells(columns, o.rows as unknown[][], heldBack) as JsonValue;
  if (line) out.shaped = line;
  if (held) out.held_back = held;
  return out;
}

/**
 * How a count held back at detail plain reaches a model (record 55 K7, small counts, the ruling of 2026-10-12): the
 * engine answers a count of fewer than 5 subjects a quasi identifying field chose or grouped as null, and one more
 * beside it so that it is not found by subtraction. A small model reads a null count as none, so every reader writes
 * it as these words instead, and says once what they mean. A held count is not always under 5 itself, and words that
 * told the two apart would say which count is the small one, so every held count reads the same.
 */
export const HELD_COUNT =
  "held back (fewer than 5, or hidden beside a small count so it cannot be worked out)";

/** The one line a model reads beside counts written as held. */
export const HELD_COUNTS_LINE = `Counts written as "${HELD_COUNT}" were held back at your detail to protect a small group: a count may be under 5 itself, or hidden beside such a count so that one cannot be worked out from the other, and which it is is not known to you. Say the number is held back to protect a small group; never say "fewer than 5" as a fact about that count, never 0 or none, never a number, and never work one out from a total or the counts around it.`;

const isRecord = (v: unknown): v is Record<string, JsonValue> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A diagnosis with its held counts written as held: a stage's rows and subjects, a drop's before, after and nulls, a
 * clause group's kept, subjects and lost, and the count of a set's ties and coarse rows, each null where the engine
 * held it back. The line comes first, so no shortening drops it; a diagnosis that holds none is unchanged.
 */
export function withHeldCounts(diagnosis: JsonValue): JsonValue {
  if (!isRecord(diagnosis)) return diagnosis;
  let held = false;
  const mark = (row: JsonValue, keys: readonly string[]): JsonValue => {
    if (!isRecord(row)) return row;
    const out: Record<string, JsonValue> = { ...row };
    for (const k of keys)
      if (k in out && out[k] === null) {
        out[k] = HELD_COUNT;
        held = true;
      }
    return out;
  };
  const pair = (row: JsonValue): JsonValue => {
    if (Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && row[1] === null) {
      held = true;
      return [row[0], HELD_COUNT];
    }
    return row;
  };
  const out: Record<string, JsonValue> = { ...diagnosis };
  const each = (key: string, f: (row: JsonValue) => JsonValue) => {
    const list = out[key];
    if (Array.isArray(list)) out[key] = list.map(f);
  };
  each("funnel", (r) => mark(r, ["rows", "subjects"]));
  each("drops", (r) => mark(r, ["before", "after", "nulls"]));
  each("groups", (r) => mark(r, ["kept", "subjects", "lost"]));
  each("ties", pair);
  each("coarse", pair);
  return held ? { held_counts: HELD_COUNTS_LINE, ...out } : diagnosis;
}

/**
 * Rows with the held counts written as held: a null cell of a column the answer names in `held_back` with a count's
 * why (fewer than 5 ...). A held mean or spread (a group under 5 subjects) stays null, as the held_back line says.
 */
export function heldCountCells(
  columns: readonly string[],
  rows: readonly unknown[][],
  held: readonly HeldBack[],
): unknown[][] {
  const counts = new Set(held.filter((h) => /^fewer than 5\b/iu.test(h.why)).map((h) => h.column));
  if (counts.size === 0) return rows as unknown[][];
  const at = columns.map((c) => counts.has(c));
  return rows.map((r) => (Array.isArray(r) ? r.map((v, i) => (v === null && at[i] ? HELD_COUNT : v)) : r));
}
