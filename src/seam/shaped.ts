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
  return held.length
    ? `Some values of these columns were held back at your detail and are null in the rows: ${held.map((h) => `${h.column} (${h.why})`).join(", ")}. Never state, compute or guess a held-back value; say which values were held back and why.`
    : null;
}

/**
 * A tool's answer with those lines as its `shaped` and `held_back`, in place of the engine's lists, which the lines
 * hold; unchanged when the answer holds nothing as shapes or held back, or is not an object.
 */
export function withShapedLine(output: JsonValue, body: unknown): JsonValue {
  const line = shapedLine(shapedOf(body) ?? []);
  const held = heldBackLine(heldBackOf(body) ?? []);
  if ((!line && !held) || !output || typeof output !== "object" || Array.isArray(output)) return output;
  return { ...output, ...(line ? { shaped: line } : {}), ...(held ? { held_back: held } : {}) };
}
