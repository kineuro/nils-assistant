// SPDX-License-Identifier: AGPL-3.0-only
// Three things a question's draft is helped with, each with made-up names
// and numbers:
// - the language's functions are found by a person's words in the
//   registry's search, one line of usage each, and only those the registry's
//   own catalog lists;
// - the registry's warnings of a stored draft reach the model whole, beside
//   the diagnosis: dates the wrong way round and a sequence read after its
//   rows were cut send it to draft again once, a sequence beside a where is
//   advice. The diagnoses below are the registry's own, as its draft door
//   gave them for three documents on its synthetic registry;
// - a maker, a scanner model, a station or a site named in a question is
//   looked up first: one spelling written from memory counted a part of what
//   three stored spellings hold.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "calendar-spellings-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { conversationOf, newTurn } = await import("../src/one/state.ts");
const { searchCatalog, TOOLS, warningsNext, warningsOf } = await import("../src/one/tools.ts");
const { flawedComplaint, spellingsComplaint } = await import("../src/one/checks.ts");
const { FUNCTION_USE, functionsFound } = await import("../src/one/functions.ts");
const { DEVICE_FIELDS, deviceCompared, deviceFields, noteLookup, otherSpellings } = await import(
  "../src/one/spellings.ts"
);
const { loadSkills } = await import("../src/one/skills.ts");

/** The warnings of three stored drafts, as the registry's draft door gave them. */
const REVERSED = {
  code: "reversed_dates",
  path: "sets.spans.where[0]",
  message:
    "this filter keeps no rows, and with the two dates the other way round it keeps some: years_between(a, b) is a minus b: put the later date first",
  next: "swap the two dates of the years_between at sets.spans.bind.span_years",
};
const INHERITED = {
  code: "sequence_inherited",
  path: "sets.pairs.where[0]",
  message:
    "gap was counted among the rows of visits (prev), before holding kept only some of them, so it is not the one among the rows here",
  next: "bind it again in this set, where bind comes after the relations and before where: pairs: {grain: session, from: holding, bind: {gap_here: <the clause of visits.gap>}, where: [<the clauses, reading gap_here>]}; or bind it in a set drawn from holding and draw this one from that",
};
const BEFORE_WHERE = {
  code: "sequence_before_where",
  path: "sets.pairs.where[0]",
  message:
    "prev in gap counts the set's rows before where keeps its rows (a set's order is its relations, has among them, then bind, then where), so it is the row among all of them, not among those this clause keeps",
  next: "to count among the rows this clause keeps, put the clause in a set of its own and draw this one from it: pairs_kept: {grain: session, where: [<this clause>]} with this set's source and relations, then pairs: {grain: session, from: pairs_kept, bind: {gap: ...}}; leave it where the count over all the rows is meant",
};
const NOT_RELEASABLE = {
  code: "not_releasable",
  path: "keep[0]",
  message:
    "spans is at grain group, which does not reach the release; its handle is a table to read and export, never to release",
  next: "keep a subject, session or stack set for a release",
};
/** A long funnel before the warnings, as a diagnosis has it: the model's copy of it is cut short. */
const funnel = Array.from({ length: 60 }, (_, i) => ({
  set: `set_${i}`,
  grain: "session",
  stage: `where a condition number ${i} that takes some room to say`,
  rows: 100 - i,
  subjects: 40,
}));
const diagnosis = (warnings: unknown[]) => ({
  valid: true,
  issues: [],
  repairs: [],
  funnel,
  warnings,
  zero_rows: null,
  next: ["read the warnings; a selection_outdated warning carries an update move"],
});

const VALUES = {
  level: "stack",
  field: "manufacturer",
  kind: "values",
  items: [
    ["ACME", 410],
    ["Acme Medical Systems", 96],
    ["acme", 7],
    ["Borealis", 230],
  ],
  distinct: 4,
  truncated: false,
};

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  const text = String((c.body as { text?: string } | null)?.text ?? "");
  if (p === "/api/capabilities") return { body: { auth: "off", detail: "sensitive" } };
  if (p === "/api/ask/catalog/stack/manufacturer/values") return { body: VALUES };
  if (p === "/api/ask/catalog/stack/station_name/values")
    return {
      body: { level: "stack", field: "station_name", kind: "shapes", items: [["AA9", 12]], distinct: 1 },
    };
  if (p === "/api/ask/draft") {
    const warnings = text.includes("dates-reversed")
      ? [NOT_RELEASABLE, REVERSED]
      : text.includes("gap-inherited")
        ? [INHERITED]
        : text.includes("gap-beside-where")
          ? [BEFORE_WHERE]
          : text.includes("only-a-table")
            ? [NOT_RELEASABLE]
            : [];
    const document = 70 + (text.match(/number (\d)/u) ? Number(text.match(/number (\d)/u)?.[1]) : 0);
    return { body: { document, hash: "h", diagnosis: diagnosis(warnings), repairs: [] } };
  }
  if (p === "/api/ask/preview")
    return { body: { level: "count", columns: ["rows", "subjects"], rows: [[12, 9]] } };
  return null;
});
afterAll(() => engine.close());
process.env.NILS_URL = engine.url;
await probeEngineAuth(engine.url);
for (const m of loadManifests(["./stations"]).values())
  registerStation({
    id: m.id,
    version: "t",
    grant: m.grant,
    ceiling: m.ceiling,
    content: m.content,
    model: "m",
  });

type Output = Record<string, unknown>;
const drafts = (): number => engine.seen.filter((c) => c.path.startsWith("/api/ask/draft")).length;
/** One turn of a chat, with its tools. */
function turnOf(id: string, message: string) {
  const convo = conversationOf(id);
  const turn = newTurn(id, message);
  const run = async (tool: keyof typeof TOOLS, args: Record<string, unknown>): Promise<Output> => {
    const r = await TOOLS[tool].run(args, {
      conversation: id,
      subject: "anna@lab",
      toolCallId: `call-${Math.random().toString(36).slice(2, 8)}`,
      turn,
      convo,
      mounted: { tools: [], skills: [], detail: "sensitive" },
      write: {
        progress: () => {},
        approval: () => {},
        clarification: () => {},
        plan: () => {},
        memory: () => {},
        chart: () => {},
        file: () => {},
      },
    } as never);
    return r.output as Output;
  };
  return { turn, convo, run, draft: (text: string) => run("query_draft", { text }) };
}

// ------------------------------------------------------------------ the functions, found

describe("the language's functions in the registry's search", () => {
  /** A catalog's function table, by family, as a registry with the calendar functions lists it. */
  const NOW = {
    comparison: ["=", "<>", ">", ">=", "<", "<=", "~=", "in", "not_in", "has", "contains"],
    dates: ["days_between", "months_between", "years_between", "shift", "age_at", "part"],
    sequences: ["ordinal", "prev", "next"],
    totals: ["count", "distinct", "min", "max", "sum", "avg", "share"],
  };
  /** An older registry: days alone. */
  const OLDER = { ...NOW, dates: ["days_between", "shift", "age_at", "part"] };
  const names = (words: string, functions: Record<string, string[]> | null = NOW): string[] =>
    functionsFound(words, functions).map((l) => /^function (\S+):/u.exec(l)?.[1] ?? l);

  it("finds a function by the words that mean it, with one line of how it is written", () => {
    expect(names("days between")).toEqual(["days_between", "months_between", "years_between"]);
    expect(names("years apart")).toEqual(expect.arrayContaining(["years_between", "days_between"]));
    expect(names("previous visit")).toEqual(["prev"]);
    expect(names("first to last")).toEqual(["min", "max"]);
    expect(names("since 2015")).toEqual([">="]);
    expect(names("gap")).toEqual(expect.arrayContaining(["days_between", "prev"]));
    expect(names("ordinal")).toEqual(["ordinal"]);
    expect(names("share")).toEqual(["share"]);
    expect(names("the second visit")).toEqual(["ordinal"]);
    const [line] = functionsFound("years apart", NOW).filter((l) => l.startsWith("function years_between"));
    expect(line).toBe(
      'function years_between: ["years_between", {}, <later day>, <earlier day>] is the whole calendar years from the second day to the first: the later day goes first. For a length said in years, with the number as said (five years are 5)',
    );
    expect(functionsFound("previous visit", NOW)[0]).toMatch(
      /among the rows the set's has kept: bind it in the set that carries the has or in one drawn from it, never in a set above/u,
    );
    // every line is one clause and what it answers
    for (const [name, use] of Object.entries(FUNCTION_USE)) {
      expect(use.usage.length, name).toBeLessThan(420);
      expect(use.usage, name).toMatch(/\[|\{/u);
    }
  });

  it("never names a function the registry's catalog does not list", () => {
    expect(names("years apart", OLDER)).toEqual(["days_between"]);
    expect(names("months between", OLDER)).toEqual(["days_between"]);
    expect(names("years apart", null)).toEqual([]);
    expect(names("years apart", {})).toEqual([]);
  });

  it("stays quiet for words that mean none, short words among them", () => {
    for (const words of ["FLAIR", "T1 in cohort", "MPRAGE at 3 tesla", "manufacturer", "in"])
      expect(names(words), words).toEqual([]);
  });

  it("comes with the names the search finds, before them", () => {
    const cat = {
      functions: NOW,
      levels: [{ level: "session", fields: [{ path: "first", type: "date", class: "plain" }] }],
      cohorts: [{ name: "ms-cohort-a", members: 24 }],
    };
    const found = searchCatalog(cat as never, "days between first");
    expect(found[0]).toMatch(/^function days_between: /u);
    expect(found).toContain("field first of session (date)");
    expect(searchCatalog({ ...cat, functions: undefined } as never, "days between first")).toEqual([
      "field first of session (date)",
    ]);
    expect(searchCatalog(cat as never, "ms-cohort-a")).toEqual(["cohort ms-cohort-a (24 members)"]);
  });
});

// ------------------------------------------------------------------ the registry's warnings

describe("the warnings of a stored draft", () => {
  it("reach the model whole, beside a diagnosis that is cut short", async () => {
    const t = turnOf("warn-1", "How many subjects have two sessions less than 180 days apart?");
    const out = await t.draft("name: gap-inherited number 1\n");
    expect(out.document).toBe(71);
    // the diagnosis the model reads is cut short for the long funnel, and the warning's fix with it
    expect(JSON.stringify(out.diagnosis)).not.toContain("draw this one from that");
    expect(out.warnings).toEqual([
      { code: "sequence_inherited", path: INHERITED.path, message: INHERITED.message, fix: INHERITED.next },
    ]);
    const reversed = await turnOf("warn-1a", "How many?").draft("name: dates-reversed number 1\n");
    expect(reversed.warnings).toEqual([
      { code: "reversed_dates", path: REVERSED.path, message: REVERSED.message, fix: REVERSED.next },
    ]);
    // what a release could take says nothing of the count, and stays in the diagnosis alone
    expect(warningsOf(diagnosis([NOT_RELEASABLE]))).toEqual([]);
    const quiet = await turnOf("warn-1b", "How many?").draft("name: only-a-table\n");
    expect(quiet.warnings).toBeUndefined();
    expect(quiet.about_warnings).toBeUndefined();
    // a fix that names a door the model cannot call is left out
    expect(
      warningsOf({
        warnings: [{ code: "selection_outdated", path: "x", message: "m", next: "POST /api/ask/x" }],
      }),
    ).toEqual([{ code: "selection_outdated", path: "x", message: "m" }]);
    expect(warningsOf(null)).toEqual([]);
    expect(warningsOf({ warnings: "none" })).toEqual([]);
  });

  it("send the model to draft again once for dates the wrong way round, and hold an answer that rests on it", async () => {
    const t = turnOf("warn-2", "How many subjects have scans at least one year apart?");
    const out = await t.draft("name: dates-reversed number 2\n");
    expect(out.about_warnings).toBe(
      "Do not answer from this count: reversed_dates means the two dates of a time difference are the wrong way round, so the filter keeps no row where it should keep some. Mend the document as the warning's fix says, at the path it names, and draft the whole document again.",
    );
    expect(t.turn.flawed).toEqual([{ document: 72, code: "reversed_dates" }]);
    // an answer that rests on it is sent back before the turn settles
    expect(flawedComplaint(t.turn, "No subject has scans a year apart (document 72).")).toBe(
      "document 72 was stored with the warning reversed_dates, which means its count is not what was asked: mend the document as the warning's fix said and draft it again, then answer from the new count",
    );
    // drafted again and mended: the answer keeps the new question, and nothing is held
    const mended = await t.draft("name: mended number 3\n");
    expect(mended.warnings).toBeUndefined();
    expect(flawedComplaint(t.turn, "9 subjects have scans at least a year apart (document 73).")).toBeNull();
  });

  it("do the same for a sequence read after its rows were cut, and never loop", async () => {
    const t = turnOf("warn-3", "How many subjects have two sessions less than 180 days apart?");
    const out = await t.draft("name: gap-inherited number 4\n");
    expect(out.warnings).toEqual([
      { code: "sequence_inherited", path: INHERITED.path, message: INHERITED.message, fix: INHERITED.next },
    ]);
    expect(String(out.about_warnings)).toMatch(
      /^Do not answer from this count: sequence_inherited means a place in the order or a gap to the row before was counted before a later set dropped rows/u,
    );
    // the same warning on the next draft: the model answers and says so, and no check holds the answer
    const again = await t.draft("name: gap-inherited number 5\n");
    expect(again.about_warnings).toBe(
      "The warning sequence_inherited is still there after another draft: answer with what the question counted, and say in one plain sentence that the count may not be what was asked, and why.",
    );
    expect(t.turn.flawed.map((f) => f.document)).toEqual([74, 75]);
    expect(
      flawedComplaint(t.turn, "9 subjects, though the gap may be to another visit (document 75)."),
    ).toBeNull();
    // a turn that asked the person something, or wrote nothing, is not held
    const asked = turnOf("warn-3b", "How many?").turn;
    asked.flawed.push({ document: 76, code: "reversed_dates" });
    asked.drafted.push(76);
    asked.asked = true;
    expect(flawedComplaint(asked, "Which cohort do you mean? (document 76)")).toBeNull();
  });

  it("show a sequence beside a where as advice, which forces no new draft", async () => {
    const t = turnOf("warn-4", "Which sessions since 2005 came less than 500 days after the one before?");
    const out = await t.draft("name: gap-beside-where number 6\n");
    expect(out.document).toBe(76);
    expect(out.warnings).toEqual([
      {
        code: "sequence_before_where",
        path: BEFORE_WHERE.path,
        message: BEFORE_WHERE.message,
        fix: BEFORE_WHERE.next,
      },
    ]);
    expect(out.about_warnings).toBe(
      "sequence_before_where is advice: the count stands as the document says it. Change the document only when the words ask for the row before among the rows that clause keeps.",
    );
    expect(t.turn.flawed).toEqual([]);
    expect(flawedComplaint(t.turn, "12 sessions (document 76).")).toBeNull();
    // both kinds in one diagnosis: the one that forces, then the advice
    const both = newTurn("warn-5", "How many?");
    expect(warningsNext(both, 77, warningsOf(diagnosis([BEFORE_WHERE, INHERITED])))).toMatch(
      /^Do not answer from this count: sequence_inherited .* draft the whole document again\. sequence_before_where is advice/u,
    );
  });
});

// ------------------------------------------------------------------ one spelling of several

const byMaker = (clause: string, params = ""): string => `ast_version: 1
name: subjects scanned on a machine of one maker
scheme: default
${params}sets:
  scans: {grain: stack, where: [${clause}]}
  found: {grain: subject, has: [{set: scans, min: 1}]}
keep: [found]
out: {set: found, level: count}
`;
const ONE = byMaker('["=", {}, ["field", {}, "manufacturer"], "Acme"]');
const TWO = byMaker(
  '["in", {}, ["field", {}, "manufacturer"], ["param", {}, "makers"]]',
  "params:\n  makers: {type: list, value: [ACME, acme]}\n",
);
const ALL = byMaker(
  '["in", {}, ["field", {}, "manufacturer"], ["param", {}, "makers"]]',
  'params:\n  makers: {type: list, value: [ACME, "Acme Medical Systems", acme]}\n',
);

describe("a maker, a scanner model, a station or a site named in a question", () => {
  it("is looked up first: a draft with one spelling from memory goes back before the registry sees it", async () => {
    const t = turnOf("spell-1", "How many subjects were scanned on an Acme machine?");
    const before = drafts();
    const out = await t.draft(ONE);
    expect(drafts()).toBe(before);
    expect(out).toEqual({
      refused: true,
      stored: false,
      why: 'the draft was not sent to the registry: the draft compares manufacturer with "Acme" as written, and the values the registry stores for manufacturer were not looked up: such a name is kept as the scanners wrote it, often in several spellings, and one spelling counts only a part',
      next: 'Look them up first: registry_search with level stack and field manufacturer. Then take every stored spelling that means what the person said and compare with `in` over a list, `params: {spellings: {type: list, value: [<each spelling>]}}` and `["in", {}, ["field", {}, "manufacturer"], ["param", {}, "spellings"]]`. Say in the answer which spellings were counted. Change only that and draft the whole document again.',
    });
    // once: the same draft again goes on
    expect((await t.draft(ONE)).document).toBe(70);
  });

  it("is held to the stored spellings once they were looked up, naming those the draft leaves out", async () => {
    const t = turnOf("spell-2", "How many subjects were scanned on an Acme machine?");
    const looked = await t.run("registry_search", { level: "stack", field: "manufacturer" });
    expect(JSON.stringify(looked)).toContain("Acme Medical Systems");
    expect(t.convo.looked.get("manufacturer")).toEqual({
      values: ["ACME", "Acme Medical Systems", "acme", "Borealis"],
      truncated: false,
    });
    const before = drafts();
    const out = await t.draft(TWO);
    expect(drafts()).toBe(before);
    expect(out.why).toBe(
      'the draft was not sent to the registry: the draft compares manufacturer with "ACME", "acme", and the registry also stores "Acme Medical Systems", which hold the same word',
    );
    expect(out.next).toBe(
      'Add each of them that means the same thing, with `in` over a list, `params: {spellings: {type: list, value: [<each spelling>]}}` and `["in", {}, ["field", {}, "manufacturer"], ["param", {}, "spellings"]]`; leave out one that is something else. Say in the answer which spellings were counted. Change only that and draft the whole document again.',
    );
    // every spelling taken: stored, with the spellings kept for the answer
    const stored = await t.draft(ALL);
    expect(stored.refused).toBeUndefined();
    expect(stored.document).toBe(70);
    expect(t.turn.spellings.get(70)).toEqual(["ACME", "Acme Medical Systems", "acme"]);
    // another maker is no other spelling
    expect(
      otherSpellings(
        ["ACME", "Acme Medical Systems", "acme"],
        VALUES.items.map((i) => String(i[0])),
      ),
    ).toEqual([]);
    expect(otherSpellings(["Acme"], ["ACME", "acme", "Borealis", "Acme Medical Systems"])).toEqual([
      "ACME",
      "acme",
      "Acme Medical Systems",
    ]);
    // a word of fewer than three letters, or of digits alone, names no other spelling
    expect(otherSpellings(["MR 1"], ["MR 2", "MR 12"])).toEqual([]);
  });

  it("keeps the lookup for the conversation: a follow-up's draft is held to it, never sent back for none", async () => {
    const first = turnOf("spell-3", "How many subjects were scanned on an Acme machine?");
    await first.run("registry_search", { level: "stack", field: "manufacturer" });
    const next = turnOf("spell-3", "And how many of them have a FLAIR?");
    const out = await next.draft(ALL);
    expect(out.refused).toBeUndefined();
    expect(next.turn.sentBack.size).toBe(0);
  });

  it("leaves everything else untouched", async () => {
    const t = turnOf("spell-4", "How many?");
    for (const clause of [
      // a sorting value is compared as it is listed
      '["=", {}, ["axis", {}, "technique"], "MPRAGE"]',
      // two scans on one scanner: a field against a field
      '["=", {}, ["field", {}, "t1.station_name"], ["field", {}, "flair.station_name"]]',
      // text that is no device's name
      '["contains", {}, ["field", {}, "text_series_description"], "sag"]',
      '["=", {}, ["field", {}, "dataset"], "study-b"]',
    ]) {
      const out = await t.draft(byMaker(clause));
      expect(out.refused, clause).toBeUndefined();
    }
    expect(t.turn.sentBack.size).toBe(0);
    expect(t.turn.spellings.size).toBe(0);
    // an attached scan's field is read by its last part, and a model named by a literal is held
    expect(
      deviceCompared(
        { sets: { a: { where: [["=", {}, ["field", {}, "t1.manufacturer_model_name"], "Model X"]] } } },
        DEVICE_FIELDS,
      ),
    ).toEqual([{ field: "manufacturer_model_name", literals: ["Model X"] }]);
    // shapes are no values: a field the person's detail does not show keeps no lookup
    await t.run("registry_search", { level: "stack", field: "station_name" });
    expect(t.convo.looked.has("station_name")).toBe(false);
    noteLookup(t.convo, "t1.station_name", { kind: "values", items: [["AB1", 3]], truncated: true });
    expect(t.convo.looked.get("station_name")).toEqual({ values: ["AB1"], truncated: true });
  });

  it("takes the device fields from the registry's catalog, where it lists them as text", () => {
    expect(deviceFields(null)).toEqual([...DEVICE_FIELDS]);
    const cat = {
      levels: [
        {
          level: "stack",
          fields: [
            { path: "manufacturer", type: "text" },
            { path: "station_name", type: "text" },
            { path: "slice_thickness", type: "number" },
          ],
        },
      ],
    };
    expect(deviceFields(cat)).toEqual(["manufacturer", "station_name"]);
    expect(deviceFields({ levels: [{ fields: [{ path: "first", type: "date" }] }] })).toEqual([
      ...DEVICE_FIELDS,
    ]);
  });

  it("is said in the answer: which spellings were counted", () => {
    const t = newTurn("spell-5", "How many subjects were scanned on an Acme machine?");
    t.drafted.push(70);
    t.spellings.set(70, ["ACME", "Acme Medical Systems", "acme"]);
    expect(spellingsComplaint(t, "12 subjects were scanned on an Acme machine (document 70).")).toBe(
      'the question counted the spellings "ACME", "Acme Medical Systems", "acme": say in the answer which spellings were counted, as they are stored',
    );
    expect(
      spellingsComplaint(
        t,
        "12 subjects were scanned on an Acme machine, counting the spellings ACME, Acme Medical Systems and acme (document 70).",
      ),
    ).toBeNull();
    // a question with no such name, or a turn that asked the person, is not held
    expect(spellingsComplaint(newTurn("spell-6", "How many?"), "12 subjects.")).toBeNull();
  });

  it("is a rule of the find-data skill", () => {
    const b = loadSkills(["./stations"], ["find-data"]).get("find-data")?.body ?? "";
    expect(b).toMatch(
      /\*\*A maker, a scanner model, a station or a site by its name\*\* .* often in several spellings\. Look the field's values up first, `registry_search` with `level: stack` and the field/u,
    );
    expect(b).toMatch(/compare with `in` over a list in `params`; never one spelling written from memory/u);
    expect(b).toMatch(/The answer says which spellings were counted/u);
  });
});
