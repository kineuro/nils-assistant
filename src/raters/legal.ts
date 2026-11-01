// SPDX-License-Identifier: AGPL-3.0-only
// Legality of a seven-axis answer under the registered constraints (nils-design
// studies/2026-09-27-header-judge/tools/legal.py, read with the registered constraints.json): every value in the
// vocabulary, the implications, the exclusions and the groups. A can't tell axis is one the answer does not name.

export const MULTI = new Set(["modifier", "construct"]);
export const AXES_CHECKED = [
  "provenance",
  "technique",
  "base",
  "body_part",
  "post_contrast",
  "modifier",
  "construct",
];

type When = { axis: string; is: string } | { any: When[] } | { all: When[] } | { not: When };

export interface Constraints {
  values: Record<string, string[]>;
  implications: { rule: string; when: When; then: { axis: string; value: string }[] }[];
  excludes: { id: string; when: When; axis: string; values: string[]; why: string }[];
  groups: Record<string, Record<string, string[]>>;
}

export type Answer = Record<string, unknown>;

/** The values an answer gives an axis, as a set; null for can't tell, none or an axis not named. */
export function valuesOf(ans: Answer, axis: string): Set<string> | null {
  let v = ans[axis];
  if (v && typeof v === "object" && !Array.isArray(v)) v = (v as { value?: unknown }).value;
  if (v === "cant_tell" || v === null || v === undefined) return null;
  if (MULTI.has(axis)) return new Set(Array.isArray(v) ? v.map(String) : [String(v)]);
  return new Set([String(v)]);
}

function holds(ans: Answer, w: When): boolean {
  if ("is" in w) {
    const s = valuesOf(ans, w.axis);
    return s !== null && s.size > 0 && s.has(w.is);
  }
  if ("any" in w) return w.any.some((x) => holds(ans, x));
  if ("all" in w) return w.all.every((x) => holds(ans, x));
  if ("not" in w) return !holds(ans, w.not);
  throw new Error("a constraint of an unknown shape");
}

const sorted = (s: Iterable<string>) => JSON.stringify([...s].sort());

/**
 * Why an answer breaks the constraints; empty when it is legal. `served` widens an axis's vocabulary by the
 * values the campaign's question serves (the schema is widened by them too, so a value it lets the model emit
 * is not then called out of the vocabulary).
 */
export function violations(ans: Answer, c: Constraints, served: Record<string, Set<string>> = {}): string[] {
  const out: string[] = [];
  for (const ax of AXES_CHECKED) {
    const s = valuesOf(ans, ax);
    if (s === null) continue;
    const legal = new Set([
      ...(c.values[ax] ?? []),
      ...(ax === "base" ? ["none"] : []),
      ...(served[ax] ?? []),
    ]);
    const bad = [...s].filter((x) => !legal.has(x));
    if (bad.length > 0) out.push(`${ax}: ${sorted(bad)} not in the vocabulary`);
  }
  for (const i of c.implications)
    if (holds(ans, i.when))
      for (const t of i.then) {
        const s = valuesOf(ans, t.axis);
        if (s !== null && !(s.size === 1 && s.has(t.value)) && !(MULTI.has(t.axis) && s.has(t.value)))
          out.push(`${i.rule}: ${t.axis} must be ${t.value}`);
      }
  for (const e of c.excludes)
    if (holds(ans, e.when)) {
      const s = valuesOf(ans, e.axis);
      const hit = s ? [...s].filter((x) => e.values.includes(x)) : [];
      if (hit.length > 0) out.push(`${e.id}: ${e.axis} cannot be ${sorted(hit)} (${e.why})`);
    }
  for (const [ax, gs] of Object.entries(c.groups)) {
    const s = valuesOf(ans, ax) ?? new Set<string>();
    for (const [g, vs] of Object.entries(gs)) {
      const hit = [...s].filter((x) => vs.includes(x));
      if (hit.length > 1) out.push(`${ax}: at most one of ${g}, got ${sorted(hit)}`);
    }
  }
  return out;
}
