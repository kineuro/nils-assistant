// SPDX-License-Identifier: AGPL-3.0-only
// The shapes of a question's parts, for a draft the registry could not read
// (2026-11-13, a live test). A document that does not parse is refused with
// one sentence and no path ("unknown field `limit`, expected one of `per`,
// `by`, `n`, `ties`", "invalid type: string, expected struct Attach",
// "invalid type: map, expected a string"), and the chat, told to fix the
// path and issue named, spent three drafts probing which keys a part takes.
// Here the sentence is read for the part it names, by its name or by the
// keys it lists, and the refusal's next step says which keys that part takes
// with one example the registry accepts. The keys are the grammar's own, in
// its order; a test holds each example to a document of the cookbook.

export interface Shape {
  /** The grammar's name for the part, as an error names it. */
  struct: string;
  /** What the part is called to the model. */
  what: string;
  /** Every key it takes, in the grammar's order. */
  keys: readonly string[];
  /** The keys it cannot do without. */
  needs: readonly string[];
  /** One example the registry accepts, where the cookbook holds one. */
  example?: string;
  /** What the keys do not say. */
  note?: string;
}

export const SHAPES: readonly Shape[] = [
  {
    struct: "Pick",
    what: "`pick`",
    keys: ["per", "by", "n", "ties"],
    needs: ["per", "by"],
    example:
      'pick: {per: session, n: 1, ties: report, by: [[["field", {}, "n_instances"], desc], [["field", {}, "id"], asc]]}',
    note: "`per` is a grain above the set's own, `by` a list of [clause, asc or desc] pairs, `n` how many rows are kept per parent, `ties` report or refuse",
  },
  {
    struct: "Attach",
    what: "an item of `attach`",
    keys: ["as", "set", "optional"],
    needs: ["as", "set"],
    example: "attach: [{as: t1, set: t1}, {as: flair, set: flair}]",
    note: "`set` names a lower set that holds one row per row here (a stack set with a pick per session), and its fields then read as `<as>.<field>`",
  },
  {
    struct: "Has",
    what: "an item of `has`",
    keys: ["set", "window", "on", "min", "max", "as"],
    needs: ["set"],
    example: "has: [{set: good, min: 2, as: n_good}]",
    note: "`min` and `max` bound how many rows of the lower set a row has, and `as` names that count as a column",
  },
  {
    struct: "Same",
    what: "an item of `same`",
    keys: ["as", "over", "by", "min", "all"],
    needs: ["as", "over", "by"],
    example:
      'same: [{as: alike, over: good, min: 2, by: [["field", {}, "t1.manufacturer_model_name"], ["field", {}, "t1.station_name"], ["field", {}, "t1.sig"], ["field", {}, "flair.sig"]]}]',
    note: "at least `min` rows of the lower set `over` share one value of every `by` key",
  },
  {
    struct: "Near",
    what: "an item of `near`",
    keys: ["as", "set", "window", "on", "policy", "tie", "order", "optional", "strict"],
    needs: ["as", "set", "window", "policy"],
  },
  { struct: "Every", what: "an item of `every`", keys: ["of", "in", "vacuous"], needs: ["of", "in"] },
  { struct: "Pairs", what: "`pairs`", keys: ["as", "window", "order"], needs: ["as", "window"] },
  { struct: "Window", what: "a `window`", keys: ["from", "to", "unit"], needs: ["unit"] },
  {
    struct: "GroupSpec",
    what: "`group`",
    keys: ["of", "by"],
    needs: ["of", "by"],
    example:
      'group: {of: scans, by: [["field", {}, "subject.code"], ["field", {}, "session.id"], ["field", {}, "manufacturer_model_name"], ["field", {}, "station_name"]]}',
    note: "the aggregates of a group go in the set's `bind`, beside `group`, never inside it",
  },
  { struct: "Algebra", what: "`algebra`", keys: ["op", "sets", "tag"], needs: ["op", "sets"] },
  {
    struct: "Set",
    what: "a set",
    keys: [
      "grain",
      "from",
      "of",
      "algebra",
      "group",
      "near",
      "attach",
      "has",
      "same",
      "every",
      "pairs",
      "bind",
      "where",
      "pick",
    ],
    needs: ["grain"],
    note: "a set has no `limit`, `count`, `columns` or `order`: how many rows are kept per parent is a pick's `n`, and `columns`, `order` and `limit` belong to `out`",
  },
  {
    struct: "Out",
    what: "`out`",
    keys: ["set", "level", "columns", "measures", "identifiers", "order", "limit"],
    needs: ["set", "level"],
    example: "out: {set: answer, level: count}",
    note: "`out` has no `by`: rows are grouped by a set at grain group",
  },
  {
    struct: "ParamDecl",
    what: "a parameter under `params`",
    keys: ["type", "value", "description"],
    needs: ["type"],
  },
  {
    struct: "Ask",
    what: "the document",
    keys: ["ast_version", "name", "scheme", "params", "values", "pipeline", "sets", "keep", "out"],
    needs: ["ast_version", "out"],
  },
];

const AGAIN = "Draft the whole document again.";

/** A part's keys and its example, as one sentence. */
function said(s: Shape): string {
  const keys = s.keys.map((k) => `\`${k}\``).join(", ");
  return `${s.what} takes only ${keys}${s.note ? ` (${s.note})` : ""}${s.example ? `, as in \`${s.example}\`` : ""}.`;
}

/** The names an error lists between backticks. */
const ticked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/gu)].map((m) => m[1] as string);

/** The part whose keys are exactly the ones an error lists, whatever their order. */
function byKeys(keys: readonly string[]): Shape | null {
  const want = [...keys].sort().join(",");
  return SHAPES.find((s) => [...s.keys].sort().join(",") === want) ?? null;
}

/**
 * The next step for a draft the registry could not read, from the one sentence it gives: which part the sentence
 * names and the keys that part takes, a list or a name where one was expected, or the line of the YAML that does not
 * read. Never "fix the path named": a document that does not parse is refused with no path.
 */
export function parseNext(words: string): string {
  const t = words.replace(/^the ask will not parse:\s*/u, "");
  if (/\bline \d+ column \d+\b/u.test(t))
    return `The YAML itself does not read at the line and column named: close every bracket and brace opened before it, and keep each clause in its own brackets. ${AGAIN}`;
  const unknown = /unknown field `([^`]+)`, expected (.*?)(?:;|$)/u.exec(t);
  if (unknown) {
    const s = byKeys(ticked(unknown[2] as string));
    return s
      ? `\`${unknown[1]}\` is no key of ${s.what}: ${said(s)} Write that part with those keys only. ${AGAIN}`
      : `\`${unknown[1]}\` is no key of the part it was written in: that part takes only the keys the message lists. ${AGAIN}`;
  }
  const struct = /expected struct (\w+)/u.exec(t);
  if (struct) {
    const s = SHAPES.find((x) => x.struct === struct[1]);
    if (s)
      return `A map with the keys of ${s.what} was expected where another value was written: ${said(s)} ${AGAIN}`;
  }
  const missing = /missing field `([^`]+)`/u.exec(t);
  if (missing) {
    const having = SHAPES.filter((s) => s.needs.includes(missing[1] as string));
    return having.length
      ? `A part was written without \`${missing[1]}\`, which it needs: ${having.map(said).join(" ")} ${AGAIN}`
      : `A part was written without \`${missing[1]}\`, which it needs. ${AGAIN}`;
  }
  if (/unknown variant/u.test(t))
    return `Use one of the values the message lists, spelled as it lists them. ${AGAIN}`;
  if (/expected a sequence/u.test(t))
    return `A list was expected where one value was written: \`where\`, \`attach\`, \`has\`, \`near\`, \`same\`, \`keep\`, \`columns\`, \`order\`, an algebra's \`sets\` and the \`by\` of a group or a pick are lists, and a pick's \`by\` is a list of [clause, asc or desc] pairs. ${AGAIN}`;
  if (/invalid type: map, expected a string|expected a string/u.test(t))
    return `A name was expected where another value was written: \`set\`, \`as\`, \`of\`, \`from\`, \`over\` and \`in\` each take the name of a set declared under \`sets\`, never a set written in place. Declare the set under \`sets\` and name it. ${AGAIN}`;
  if (
    /a clause is an array|options map is mandatory|is not an argument|bind is a map|clause starts with/u.test(
      t,
    )
  )
    return `A clause is always an array [op, {options}, ...arguments], the options map present even when empty, and a field is read as ["field", {}, "<name>"]; \`bind\` is a map of a name to one clause. ${AGAIN}`;
  return `The message names no path: compare the part you changed last with the exact shapes of the find-data skill, and write it as shown there. ${AGAIN}`;
}
