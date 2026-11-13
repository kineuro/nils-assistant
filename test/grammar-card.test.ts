// SPDX-License-Identifier: AGPL-3.0-only
// The exact shapes of a question (2026-11-13, a live test). Asked for the
// subjects with two alike sessions, the chat guessed the grammar: its drafts
// were refused with "invalid type: integer `1`, expected a sequence",
// "expected struct Attach", "unknown field `foo`, expected one of `as`,
// `set`, `optional`", "unknown field `limit`" and "invalid type: map,
// expected a string", three drafts went on probing which keys a part takes,
// and several searches on how to write the loose signature. Held here:
// - the find-data skill carries a card of the shapes that question needs, and
//   every line of it is a line of a worked example, which the registry
//   accepts (each example of the cookbook named here was validated with the
//   engine's own `ask validate`; this test holds the card to those files);
// - a draft the registry could not read is told which keys the part takes,
//   from the sentence the registry gives, and never "the path named";
// - a search says how a derived field and a comparability level are written.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parseNext, SHAPES } from "../src/one/grammar.ts";
import { bodyFor, findExamples, loadSkills } from "../src/one/skills.ts";
import { searchCatalog, unreadWords } from "../src/one/tools.ts";
import { derivedRef, renderCatalog } from "../src/stations/prelude.ts";
import { closest } from "../src/stations/select.ts";

const COOKBOOK = "stations/ask-help/cookbook";
/** The worked examples the card's lines are taken from, each accepted by the registry as it stands. */
const SOURCES = [
  "two-alike-sessions.ask.yml",
  "alike-sessions-per-scanner.ask.yml",
  "protocol-homogeneity.ask.yml",
];
/** A line as it is compared: without its indentation, runs of spaces as one. */
const flat = (line: string): string => line.trim().replace(/\s+/gu, " ");
const lines = new Set(SOURCES.flatMap((f) => readFileSync(`${COOKBOOK}/${f}`, "utf8").split("\n").map(flat)));

const skill = loadSkills(["./stations"], ["find-data"]).get("find-data");
if (!skill) throw new Error("the find-data skill is missing");
const card = /## The exact shapes\n[\s\S]*?```\n([\s\S]*?)```/u.exec(skill.body)?.[1] ?? "";
const shown = card
  .split("\n")
  .map(flat)
  .filter((l) => l && !l.startsWith("#"));

describe("the card of exact shapes in the find-data skill", () => {
  it("shows only lines of worked examples the registry accepts", () => {
    expect(shown.length).toBeGreaterThanOrEqual(15);
    for (const l of shown) expect(lines.has(l), `not a line of a worked example: ${l}`).toBe(true);
  });

  it("covers the shapes the question needed, each with its keys", () => {
    const has = (re: RegExp) =>
      expect(
        shown.some((l) => re.test(l)),
        String(re),
      ).toBe(true);
    has(/^pick: \{per: session, n: 1, ties: report, by: \[\[/u);
    has(/^attach: \[\{as: t1, set: t1\}/u);
    has(/\["field", \{\}, "t1\.station_name"\], \["field", \{\}, "flair\.station_name"\]/u);
    has(/^has: \[\{set: good, min: 2, as: n_good\}\]/u);
    has(/^same: \[\{as: alike, over: good, min: 2, by: \[/u);
    has(/^group: \{of: scans, by: \[\["field", \{\}, "subject\.code"\], \["field", \{\}, "session\.id"\]/u);
    // a nested group, keyed by the inner group's keys and aggregates
    has(/^group: \{of: per_session, by: .*"sig_t1"\], \["field", \{\}, "sig_fl"\]\]\}$/u);
    for (const fn of ["count", "sum", "distinct", "min"]) has(new RegExp(`\\["${fn}", \\{set: \\w+\\}`, "u"));
    has(/^is_t1: \["case", \{\}, \["=", \{\}, \["axis", \{\}, "base"\], "T1w"\], 1, 0\]$/u);
    has(/\["derived", \{\}, "acquisition_type"\], "3D"\]/u);
    has(/\["derived", \{third: slice_thickness\}, "voxel"\], 1\.2\]/u);
    has(/^sig: \["derived", \{level: loose\}, "signature"\]$/u);
    // the keys each part takes are said beside its example, as the grammar has them
    for (const struct of ["Pick", "Attach", "Has", "Same", "GroupSpec"]) {
      const s = SHAPES.find((x) => x.struct === struct);
      const said = card
        .split("\n")
        .filter((l) => l.startsWith("#"))
        .join(" ");
      for (const k of s?.keys.filter((k) => !["window", "on"].includes(k)) ?? [])
        expect(said, `${struct}.${k}`).toMatch(new RegExp(`\\b${k}\\b`, "u"));
    }
    // how a parent's field is named, and what a set does not take
    expect(card).toMatch(/subject\.id, subject\.code, session\.id, session\.first\. Never subject_id/u);
    expect(card).toMatch(/It has no limit, count, columns or order/u);
    expect(card).toMatch(/never a set written in place/u);
  });

  it("reaches the model with the skill, and stays a card", () => {
    const body = bodyFor(skill, "how many subjects?", []);
    expect(body).toContain("## The exact shapes");
    // every token of it is read on every call of a turn that finds data
    expect(card.length).toBeLessThan(3600);
  });

  it("is backed by two worked examples that read as documents and say what they are", () => {
    for (const f of SOURCES.slice(0, 2)) {
      const raw = readFileSync(`${COOKBOOK}/${f}`, "utf8");
      expect(raw).toMatch(/^# question: .{40,}$/mu);
      expect(raw).toMatch(/^# synthetic: /mu);
      const doc = parse(raw) as {
        ast_version: number;
        sets: Record<string, { grain: string }>;
        out: { set: string };
      };
      expect(doc.ast_version).toBe(1);
      expect(Object.keys(doc.sets)).toContain(doc.out.set);
      // no cohort, dataset or site of anyone's: the bench's made-up cohort
      expect(raw).toContain('"ms-cohort-a"');
    }
    const picked = parse(readFileSync(`${COOKBOOK}/${SOURCES[0]}`, "utf8")) as {
      sets: Record<string, Record<string, unknown>>;
    };
    expect(picked.sets.t1.pick).toMatchObject({ per: "session", n: 1, ties: "report" });
    expect(picked.sets.good.attach).toEqual([
      { as: "t1", set: "t1" },
      { as: "flair", set: "flair" },
    ]);
    expect(picked.sets.answer.same).toMatchObject([{ as: "alike", over: "good", min: 2 }]);
  });

  it("puts the worked example first for the question the live test asked", () => {
    const examples = findExamples(["./stations"]);
    const asked =
      "In the study cohort, count the subjects who have at least 2 sessions with both a 3D T1 and a 3D FLAIR, each with voxel size at most 1.2 mm, where the two are on the same scanner and the sessions share the same scanner and the same protocol (loose level). Return the count and show me the query.";
    expect(closest(asked, examples, 3)[0]?.file).toBe("two-alike-sessions.ask.yml");
    expect(bodyFor(skill, asked, examples)).toContain("same: [{as: alike, over: good, min: 2, by: [");
  });
});

describe("a draft the registry could not read", () => {
  /** The registry's own sentences for the shapes the chat got wrong, as its draft door gave them. */
  const said = {
    attachWord: 'the ask will not parse: invalid type: string "t1", expected struct Attach',
    attachKey: "the ask will not parse: unknown field `foo`, expected one of `as`, `set`, `optional`",
    list: "the ask will not parse: invalid type: integer `1`, expected a sequence",
    name: "the ask will not parse: invalid type: map, expected a string",
    pickLimit:
      'the ask will not parse: unknown field `limit`, expected one of `per`, `by`, `n`, `ties`; pick keeps the first rows of a set by an order (per, by, n, ties); the main scans NILS picked are a stack set\'s where: [["picked", {role: t1w}]], one role per clause',
    setLimit:
      "the ask will not parse: unknown field `limit`, expected one of `grain`, `from`, `of`, `algebra`, `group`, `near`, `attach`, `has`, `same`, `every`, `pairs`, `bind`, `where`, `pick`",
    hasCount:
      "the ask will not parse: unknown field `count`, expected one of `set`, `window`, `on`, `min`, `max`, `as`",
    groupCount: "the ask will not parse: unknown field `count`, expected `of` or `by`",
    outBy:
      "the ask will not parse: unknown field `by`, expected one of `set`, `level`, `columns`, `measures`, `identifiers`, `order`, `limit`",
    noPer: "the ask will not parse: missing field `per`",
    ties: "the ask will not parse: unknown variant `first`, expected `report` or `refuse`",
    object: 'the ask will not parse: an object is not an argument; a ref is ["field", {}, path]',
    bind: "the ask will not parse: bind is a map of name to clause",
    yaml: "the ask will not parse: error: line 8 column 4: while parsing a flow mapping, did not find expected ',' or '}'",
  };

  it("is told the keys of the part the sentence names, with one example the registry accepts", () => {
    const attach =
      "`attach` takes only `as`, `set`, `optional` (`set` names a lower set that holds one row per row here (a stack set with a pick per session), and its fields then read as `<as>.<field>`), as in `attach: [{as: t1, set: t1}, {as: flair, set: flair}]`.";
    expect(parseNext(said.attachWord)).toBe(
      `A map with the keys of an item of \`attach\` was expected where another value was written: an item of ${attach} Draft the whole document again.`,
    );
    expect(parseNext(said.attachKey)).toBe(
      `\`foo\` is no key of an item of \`attach\`: an item of ${attach} Write that part with those keys only. Draft the whole document again.`,
    );
    expect(parseNext(said.pickLimit)).toMatch(
      /^`limit` is no key of `pick`: `pick` takes only `per`, `by`, `n`, `ties` \(.*`n` how many rows are kept per parent.*\), as in `pick: \{per: session, n: 1, ties: report, by: \[\[/u,
    );
    expect(parseNext(said.setLimit)).toMatch(
      /^`limit` is no key of a set: a set takes only `grain`, `from`, `of`, .*`pick` \(a set has no `limit`, `count`, `columns` or `order`: how many rows are kept per parent is a pick's `n`, and `columns`, `order` and `limit` belong to `out`\)\./u,
    );
    expect(parseNext(said.hasCount)).toMatch(
      /^`count` is no key of an item of `has`: .*`has: \[\{set: good, min: 2, as: n_good\}\]`/u,
    );
    expect(parseNext(said.groupCount)).toMatch(
      /^`count` is no key of `group`: `group` takes only `of`, `by` \(the aggregates of a group go in the set's `bind`, beside `group`, never inside it\)/u,
    );
    expect(parseNext(said.outBy)).toMatch(
      /^`by` is no key of `out`: .*rows are grouped by a set at grain group/u,
    );
    expect(parseNext(said.noPer)).toMatch(
      /^A part was written without `per`, which it needs: `pick` takes only `per`, `by`, `n`, `ties`/u,
    );
  });

  it("is told a list or a name was expected, the clause's form, or where the YAML does not read", () => {
    expect(parseNext(said.list)).toMatch(
      /^A list was expected where one value was written: .*a pick's `by` is a list of \[clause, asc or desc\] pairs/u,
    );
    expect(parseNext(said.name)).toMatch(
      /^A name was expected where another value was written: `set`, `as`, `of`, `from`, `over` and `in` each take the name of a set declared under `sets`, never a set written in place/u,
    );
    expect(parseNext(said.ties)).toBe(
      "Use one of the values the message lists, spelled as it lists them. Draft the whole document again.",
    );
    expect(parseNext(said.object)).toMatch(
      /^A clause is always an array \[op, \{options\}, \.\.\.arguments\]/u,
    );
    expect(parseNext(said.bind)).toMatch(/`bind` is a map of a name to one clause/u);
    expect(parseNext(said.yaml)).toMatch(/^The YAML itself does not read at the line and column named/u);
    expect(parseNext("the ask will not parse: something new")).toMatch(/^The message names no path: /u);
    for (const words of Object.values(said)) {
      expect(parseNext(words)).not.toMatch(/path and issue named/u);
      expect(parseNext(words)).toMatch(/Draft the whole document again\.$/u);
    }
  });

  it("takes every example it gives from a worked example, and the grammar's keys as the registry lists them", () => {
    for (const s of SHAPES) if (s.example) expect(lines.has(flat(s.example)), s.example).toBe(true);
    // the keys the registry's own sentences list are the ones kept here, part by part
    const listed = (words: string) =>
      [
        ...words
          .split("expected")[1]
          .split(";")[0]
          .matchAll(/`([^`]+)`/gu),
      ].map((m) => m[1]);
    expect(SHAPES.find((s) => s.struct === "Attach")?.keys).toEqual(listed(said.attachKey));
    expect(SHAPES.find((s) => s.struct === "Pick")?.keys).toEqual(listed(said.pickLimit));
    expect(SHAPES.find((s) => s.struct === "Set")?.keys).toEqual(listed(said.setLimit));
    expect(SHAPES.find((s) => s.struct === "Has")?.keys).toEqual(listed(said.hasCount));
    expect(SHAPES.find((s) => s.struct === "GroupSpec")?.keys).toEqual(listed(said.groupCount));
    expect(SHAPES.find((s) => s.struct === "Out")?.keys).toEqual(listed(said.outBy));
  });

  it("is read as unparsed only when the registry gave one sentence and no list of issues", () => {
    expect(unreadWords({ kind: "refused", status: 400, body: { error: said.list } })).toBe(said.list);
    expect(
      unreadWords({
        kind: "refused",
        status: 400,
        body: { error: "the document is refused", issues: [{ path: "sets.a", message: "x" }] },
      }),
    ).toBeNull();
    expect(unreadWords({ kind: "refused", status: 504, body: { error: "ran past" } })).toBeNull();
    expect(unreadWords({ kind: "ok", status: 200, body: { document: 1 } })).toBeNull();
  });
});

describe("how a derived field and a comparability level are written", () => {
  const catalog = {
    derived: [
      { name: "acquisition_type", grain: "stack", params: [], description: "2D or 3D" },
      {
        name: "voxel",
        grain: "stack",
        params: [["third", "slice_thickness"]],
        description: "the largest voxel edge",
      },
      {
        name: "signature",
        grain: "stack",
        params: [["level", "loose"]],
        description: "the acquisition's tuple at a comparability level of the pack",
      },
      { name: "course", grain: "subject", params: [["disease", ""]], description: "the current course" },
    ],
    comparability_levels: [
      { name: "exact", description: "every number as read" },
      { name: "loose", description: "the numbers rounded widest" },
    ],
  } as never;

  it("writes a derived field with the options the catalog lists", () => {
    expect(derivedRef({ name: "acquisition_type", params: [] })).toBe('["derived", {}, "acquisition_type"]');
    expect(derivedRef({ name: "signature", params: [["level", "loose"]] })).toBe(
      '["derived", {level: loose}, "signature"]',
    );
    expect(derivedRef({ name: "course", params: [["disease", ""]] })).toBe(
      '["derived", {disease: "<disease>"}, "course"]',
    );
  });

  it("answers a search for the loose signature with how to write it, and for the protocol with the levels", () => {
    const level = (name: string, means: string) =>
      `comparability level ${name} (${means}): a stack's protocol at this level is ["derived", {level: ${name}}, "signature"], bound on the stack set and compared or grouped; two stacks have the same protocol when the two are equal`;
    // the signature with how it is written, and the levels it takes
    expect(searchCatalog(catalog, "loose signature")).toEqual([
      'derived signature (stack): the acquisition\'s tuple at a comparability level of the pack; written ["derived", {level: loose}, "signature"]',
      level("exact", "every number as read"),
      level("loose", "the numbers rounded widest"),
    ]);
    // a level asked for by its name alone
    expect(searchCatalog(catalog, "loose")).toEqual([level("loose", "the numbers rounded widest")]);
    const protocol = searchCatalog(catalog, "same protocol");
    expect(protocol[0]).toMatch(/^derived signature \(stack\)/u);
    expect(protocol.filter((l) => l.startsWith("comparability level ")).length).toBe(2);
    expect(searchCatalog(catalog, "voxel")).toEqual([
      'derived voxel (stack): the largest voxel edge; written ["derived", {third: slice_thickness}, "voxel"]',
    ]);
  });

  it("lists the levels and the options in the registry's summary", () => {
    const text = renderCatalog(catalog);
    expect(text).toContain(
      'signature (stack: the acquisition\'s tuple at a comparability level of the pack; written `["derived", {level: loose}, "signature"]`)',
    );
    expect(text).toContain("acquisition_type (stack: 2D or 3D)");
    expect(text).toMatch(
      /^Comparability levels \(the `level` of the derived field signature; .*\): exact \(every number as read\); loose \(the numbers rounded widest\)$/mu,
    );
  });
});
