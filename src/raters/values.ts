// SPDX-License-Identifier: AGPL-3.0-only
// From the model's answer to the campaign's joint answer (audit_raters_7b.py: axis_value, earlier_of, translate,
// campaign_value, question_values): one vocabulary, the served pack's, and never a silent rename. A rater's value
// is first read through the question's `earlier_names`; a value the question does not offer becomes cant_tell on
// that axis and is counted as out of vocabulary.

import { MULTI } from "./legal.ts";
import { type Question, valueId } from "./prompt.ts";

export type AxisValue = string | string[] | null;
export type Earlier = Record<string, Record<string, string | null>>;

/** The value the model gave an axis; a missing or null axis reads as can't tell. */
export function axisValue(ans: Record<string, unknown> | null, axis: string): AxisValue {
  const a = ans?.[axis];
  const v =
    a && typeof a === "object" && !Array.isArray(a) ? ((a as { value?: unknown }).value ?? "cant_tell") : a;
  if (v === null || v === undefined) return "cant_tell";
  if (Array.isArray(v)) return v.map(String);
  return String(v);
}

/** The campaign document, whether the door wrapped it in `campaign` or not. */
export function campaignOf(doc: Record<string, unknown>): Record<string, unknown> {
  const inner = doc.campaign;
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : doc;
}

/** question.earlier_names: {axis: {former id, label or stored form: value id | null}}. */
export function earlierOf(doc: Record<string, unknown>): Earlier {
  const q = (campaignOf(doc).question ?? {}) as Question;
  const out: Earlier = {};
  for (const [axis, m] of Object.entries(q.earlier_names ?? {}))
    if (m && typeof m === "object" && !Array.isArray(m)) out[axis] = { ...m };
  return out;
}

/**
 * A rater's value through the question's `earlier_names`, where it is not a value the question offers. A base
 * "no value" (none) becomes null, on a list axis nothing (an empty list); a name the table does not know stays as
 * it is, to be counted as out of vocabulary. cant_tell is never touched.
 */
export function translate(
  v: AxisValue,
  axis: string,
  allowed: Set<string> | null,
  earlier: Earlier,
): { value: AxisValue; changed: boolean } {
  const names = earlier[axis] ?? {};
  const one = (x: string): [string | null, boolean] => {
    if (x === "cant_tell" || allowed?.has(x)) return [x, false];
    if (x in names) return [names[x] ?? null, true];
    return [x, false];
  };
  if (Array.isArray(v)) {
    const out: string[] = [];
    let changed = false;
    for (const x of v) {
      const [y, c] = one(x);
      changed ||= c;
      if (y !== null && !out.includes(y)) out.push(y);
      else if (y === null) changed = true;
    }
    return { value: out, changed };
  }
  if (v === null) return { value: MULTI.has(axis) ? [] : null, changed: false };
  const [y, c] = one(v);
  if (y === null && MULTI.has(axis)) return { value: [], changed: c };
  return { value: y, changed: c };
}

/** The counts the joint answer's making keeps: cells, never values of an item. */
export interface ValueCounts {
  cant_tell_cells: Record<string, number>;
  out_of_vocabulary_cells: Record<string, number>;
  translated_cells: Record<string, number>;
}

export function valueCounts(): ValueCounts {
  return { cant_tell_cells: {}, out_of_vocabulary_cells: {}, translated_cells: {} };
}

const bump = (t: Record<string, number>, k: string) => {
  t[k] = (t[k] ?? 0) + 1;
};

/**
 * The campaign's joint answer: {axis: value | [values] | cant_tell | null} on every asked axis, as the text the
 * answer door keeps (keys sorted). A value the campaign's question does not offer becomes cant_tell on that axis.
 */
export function campaignValue(
  ans: Record<string, unknown> | null,
  axes: string[],
  legal: Record<string, Set<string>>,
  counts: ValueCounts,
  earlier: Earlier = {},
): string {
  const out: Record<string, AxisValue> = {};
  for (const a of [...axes].sort()) {
    let v = axisValue(ans, a);
    const allowed = legal[a] ?? null;
    if (v !== "cant_tell") {
      const t = translate(v, a, allowed, earlier);
      v = t.value;
      if (t.changed) bump(counts.translated_cells, a);
    }
    if (allowed !== null && v !== "cant_tell" && v !== null) {
      const vs = Array.isArray(v) ? v : [v];
      if (vs.some((x) => !allowed.has(x))) {
        bump(counts.out_of_vocabulary_cells, a);
        v = "cant_tell";
      }
    }
    if (v === "cant_tell") bump(counts.cant_tell_cells, a);
    out[a] = v;
  }
  return JSON.stringify(out);
}

/** The asked axes and, where the campaign states them, each axis's legal values. */
export function questionValues(
  doc: Record<string, unknown>,
  fallback: string[],
): { axes: string[]; legal: Record<string, Set<string>> } {
  const c = campaignOf(doc);
  const q = (c.question ?? {}) as Question & { axes?: unknown };
  const raw = (Array.isArray(q.axes) ? q.axes : Array.isArray(c.axes) ? c.axes : fallback) as unknown[];
  const axes: string[] = [];
  const legal: Record<string, Set<string>> = {};
  for (const a of raw) {
    if (a && typeof a === "object") {
      const o = a as { axis?: unknown; name?: unknown; values?: unknown[] };
      const n = String(o.axis ?? o.name ?? "");
      if (!n) continue;
      axes.push(n);
      if (Array.isArray(o.values) && o.values.length > 0)
        legal[n] = new Set(o.values.map(valueId).filter((x): x is string => x !== null));
    } else axes.push(String(a));
  }
  for (const [n, v] of Object.entries(q.values ?? {}))
    legal[n] = new Set(v.map(valueId).filter((x): x is string => x !== null));
  return { axes, legal };
}
