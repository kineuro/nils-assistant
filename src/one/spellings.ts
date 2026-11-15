// SPDX-License-Identifier: AGPL-3.0-only
// One spelling of several. Asked for the subjects scanned on one maker's
// machines, a chat compared the manufacturer with one spelling written from
// memory, where the registry keeps the name as the scanners wrote it, in
// several spellings; other chats looked the stored values up first and took
// all of them, and counted more. The lookup is the rule, and it is held in
// the draft: a free-text device field compared with a literal goes back
// once when its values were not looked up in this conversation, and once
// when they were and the registry stores other spellings that hold the same
// word. Kept narrow to the device's own text (the maker, the model, the
// station, the site); a sorting value (an axis) is never touched.

import type { ConversationState } from "./state.ts";

/** The free-text fields a scanner writes about itself and its site, by their names in the registry. */
export const DEVICE_FIELDS: readonly string[] = [
  "manufacturer",
  "manufacturer_model_name",
  "station_name",
  "institution_name",
  "institutional_department_name",
  "software_versions",
  "receive_coil_name",
  "transmit_coil_name",
];

interface LevelLike {
  fields: { path: string; type: string }[];
}

/**
 * The device fields a registry has: of the list, those its catalog lists as text at some level; the whole list
 * where no catalog was read, or it lists none of them (a page of fields cut short).
 */
export function deviceFields(cat: { levels?: LevelLike[] } | null | undefined): string[] {
  const text = new Set(
    (cat?.levels ?? []).flatMap((l) => l.fields.filter((f) => f.type === "text").map((f) => f.path)),
  );
  const have = DEVICE_FIELDS.filter((f) => text.has(f));
  return have.length ? have : [...DEVICE_FIELDS];
}

/** The field a path names: its last part, so an attached scan's `t1.station_name` is `station_name`. */
const leaf = (path: string): string => path.slice(path.lastIndexOf(".") + 1);

/**
 * What a values lookup gave, kept for the conversation: the stored values of a field, and whether the registry
 * cut the list short. Shapes (a field whose values the person's detail does not show) are no values.
 */
export function noteLookup(convo: Pick<ConversationState, "looked">, field: string, body: unknown): void {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.kind !== undefined && b.kind !== "values") return;
  const items = Array.isArray(b.items) ? b.items : null;
  if (!items) return;
  const values = items.flatMap((i) => (Array.isArray(i) && typeof i[0] === "string" ? [i[0]] : []));
  convo.looked.set(leaf(field), { values, truncated: b.truncated === true });
}

/** One device field a draft compares with literals. */
export interface Compared {
  field: string;
  literals: string[];
}

type Clause = [string, Record<string, unknown>, ...unknown[]];
const isMap = (x: unknown): x is Record<string, unknown> =>
  Boolean(x) && typeof x === "object" && !Array.isArray(x);
const isClause = (x: unknown): x is Clause =>
  Array.isArray(x) && x.length >= 2 && typeof x[0] === "string" && isMap(x[1]);

function clausesOf(x: unknown, out: Clause[] = [], depth = 0): Clause[] {
  if (depth > 40) return out;
  if (isClause(x)) out.push(x);
  if (Array.isArray(x)) for (const y of x) clausesOf(y, out, depth + 1);
  else if (isMap(x)) for (const y of Object.values(x)) clausesOf(y, out, depth + 1);
  return out;
}

/** The device fields a draft compares with literals by `=` or `in`, with the literals, one entry a field. */
export function deviceCompared(doc: Record<string, unknown>, fields: readonly string[]): Compared[] {
  const by = new Map<string, Set<string>>();
  for (const c of clausesOf(doc.sets)) {
    if (c[0] !== "=" && c[0] !== "in") continue;
    const args = c.slice(2);
    const named = args.flatMap((a) =>
      isClause(a) && a[0] === "field" && typeof a[2] === "string" && fields.includes(leaf(a[2]))
        ? [leaf(a[2])]
        : [],
    );
    if (named.length !== 1) continue;
    const literals = args.flatMap((a): string[] => {
      if (typeof a === "string") return [a];
      if (isClause(a) && a[0] === "param" && typeof a[2] === "string") {
        const p = isMap(doc.params) ? doc.params[a[2]] : null;
        const v = isMap(p) ? p.value : p;
        return (Array.isArray(v) ? v : [v]).filter((s): s is string => typeof s === "string");
      }
      return [];
    });
    if (literals.length === 0) continue;
    const set = by.get(named[0]) ?? new Set<string>();
    for (const l of literals) set.add(l);
    by.set(named[0], set);
  }
  return [...by].map(([field, literals]) => ({ field, literals: [...literals] }));
}

/** The words of a spelling: runs of letters and digits of three or more that hold a letter, in lower case. */
const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && /\p{L}/u.test(w));

/** The stored values a draft leaves out that hold a word of one it names, whatever the case. */
export function otherSpellings(literals: readonly string[], stored: readonly string[]): string[] {
  // a comparison is by the letters as they are stored: the same name in another case is another spelling
  const named = new Set(literals);
  const words = new Set(literals.flatMap(wordsOf));
  return stored.filter((v) => !named.has(v) && [...words].some((w) => v.toLowerCase().includes(w)));
}

/** One fault of a draft's spellings: its key, what is wrong, and what to do. */
export interface SpellingFault {
  key: string;
  why: string;
  next: string;
}

const quoted = (xs: readonly string[]): string => xs.map((x) => `"${x}"`).join(", ");

/**
 * What a draft does against the rule of spellings: a device field compared with literals whose stored values the
 * conversation never looked up, or looked up and left out spellings that hold the same word.
 */
export function spellingFaults(
  doc: Record<string, unknown>,
  looked: ConversationState["looked"],
  fields: readonly string[],
): SpellingFault[] {
  const out: SpellingFault[] = [];
  for (const c of deviceCompared(doc, fields)) {
    const seen = looked.get(c.field);
    const list = `\`params: {spellings: {type: list, value: [<each spelling>]}}\` and \`["in", {}, ["field", {}, "${c.field}"], ["param", {}, "spellings"]]\``;
    if (!seen) {
      out.push({
        key: `spelling-unread:${c.field}`,
        why: `the draft compares ${c.field} with ${quoted(c.literals)} as written, and the values the registry stores for ${c.field} were not looked up: such a name is kept as the scanners wrote it, often in several spellings, and one spelling counts only a part`,
        next: `Look them up first: registry_search with level stack and field ${c.field}. Then take every stored spelling that means what the person said and compare with \`in\` over a list, ${list}. Say in the answer which spellings were counted.`,
      });
      continue;
    }
    const others = otherSpellings(c.literals, seen.values);
    if (others.length)
      out.push({
        key: `spelling-others:${c.field}`,
        why: `the draft compares ${c.field} with ${quoted(c.literals)}, and the registry also stores ${quoted(others.slice(0, 12))}${others.length > 12 ? ` and ${others.length - 12} more` : ""}, which hold the same word`,
        next: `Add each of them that means the same thing, with \`in\` over a list, ${list}; leave out one that is something else. Say in the answer which spellings were counted.`,
      });
  }
  return out;
}

/** The spellings a draft counted, for the answer to name: every literal it compares a device field with. */
export function spellingsCounted(doc: Record<string, unknown>, fields: readonly string[]): string[] {
  return deviceCompared(doc, fields).flatMap((c) => c.literals);
}
