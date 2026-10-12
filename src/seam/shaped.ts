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

/**
 * A tool's answer with that line as its `shaped`, in place of the engine's list of names, which the line holds;
 * unchanged when the answer holds nothing as shapes or is not an object.
 */
export function withShapedLine(output: JsonValue, body: unknown): JsonValue {
  const line = shapedLine(shapedOf(body) ?? []);
  if (!line || !output || typeof output !== "object" || Array.isArray(output)) return output;
  return { ...output, shaped: line };
}
