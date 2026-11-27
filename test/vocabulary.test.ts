// SPDX-License-Identifier: AGPL-3.0-only
// What a sorting value means, with made-up names and numbers. A person asked
// for scans that are "all brain", the chat wrote the fine value of that name
// (the stacks that end above the neck) where the region was meant, and then
// explained the small count away. Held here:
// - the registry's summary says what a value means and which fine values a
//   wider one covers, where the catalog says, and grows by little;
// - the search finds a value by a person's word and shows the wider value
//   before the fine one;
// - the registry's warning of a filter narrower than the words
//   (narrow_value) sends the model to draft again, once a turn;
// - a catalog and a diagnosis of an older registry read as they did.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(join(tmpdir(), "vocabulary-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { conversationOf, newTurn } = await import("../src/one/state.ts");
const { axisAbout, partLines, searchCatalog, sortingLine, termsFound, TOOLS, warningsNext, warningsOf } =
  await import("../src/one/tools.ts");
const { flawedComplaint } = await import("../src/one/checks.ts");
const { factsSummary } = await import("../src/one/facts.ts");
const { forgetPrelude, MEANING_CHARS, renderAxis, renderCatalog } = await import(
  "../src/stations/prelude.ts"
);
type Catalog = import("../src/stations/prelude.ts").Catalog;

/** A catalog as a registry that says what its values mean serves it. */
const CATALOG = JSON.parse(readFileSync("test/vectors/catalog-vocabulary.json", "utf8")) as Catalog;
/** The same catalog as an older registry serves it: no meaning, no other words, no relation between axes. */
const OLDER: Catalog = {
  ...CATALOG,
  axes: CATALOG.axes?.map(({ coarse_of: _coarse, ...a }) => ({
    ...a,
    values: a.values.map(({ description: _d, terms: _t, covers: _c, within: _w, ...v }) => v),
  })),
};
const HEAD =
  'the head: what "a brain scan" or "a head scan" means in ordinary words, a brain or a brain and neck, however far down the stack reaches (body_part splits it into brain and brain-neck)';
const BRAIN =
  'the brain, the stack ending at or above C2. With brain-neck it is the fine split of the head (body_region head) by how far down the stack reaches; "a brain scan" in ordinary words is body_region head, not this value alone';

/** The warning of a filter narrower than the words, as the registry's diagnosis carries it. */
const NARROW = {
  code: "narrow_value",
  path: "sets.scans.where[0]",
  message:
    "scans: body_part = brain kept 31 of 4,210 stacks; brain-neck holds 3,900 of the rest. If any head of body_region is meant, write body_region = head, which covers brain and brain-neck.",
  next: 'to keep them all, write ["=",{},["axis",{},"body_region"],"head"] at sets.scans.where[0]; where only brain is meant, change nothing',
};
const REVERSED = {
  code: "reversed_dates",
  path: "sets.spans.where[0]",
  message: "this filter keeps no rows, and with the two dates the other way round it keeps some",
  next: "swap the two dates of the years_between at sets.spans.bind.span_years",
};
const diagnosis = (warnings?: unknown[]) => ({
  valid: true,
  issues: [],
  repairs: [],
  funnel: [
    { set: "scans", grain: "stack", stage: "source", rows: 4210, subjects: 300 },
    { set: "scans", grain: "stack", stage: "where body_part = brain", rows: 31, subjects: 20 },
  ],
  ...(warnings ? { warnings } : {}),
  zero_rows: null,
});

let older = false;
const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  const text = String((c.body as { text?: string } | null)?.text ?? "");
  if (p === "/api/capabilities") return { body: { auth: "off", detail: "sensitive" } };
  if (p === "/api/ask/catalog") return { body: older ? OLDER : CATALOG };
  if (p === "/api/ask/draft") {
    const document = 40 + Number(/number (\d+)/u.exec(text)?.[1] ?? 0);
    // an older registry's diagnosis carries no such warning, and one of a document with none has no list at all
    const warnings = text.includes("narrow-and-reversed")
      ? [NARROW, REVERSED]
      : text.includes("narrow")
        ? [NARROW]
        : text.includes("no-list")
          ? undefined
          : [];
    return { body: { document, hash: "h", diagnosis: diagnosis(warnings), repairs: [] } };
  }
  if (p === "/api/ask/preview")
    return { body: { level: "count", columns: ["rows", "subjects"], rows: [[31, 20]] } };
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
/** One turn of a chat, with its tools. */
function turnOf(id: string, message: string, subject = "anna@lab") {
  const convo = conversationOf(id);
  const turn = newTurn(id, message);
  const run = async (tool: keyof typeof TOOLS, args: Record<string, unknown>): Promise<Output> => {
    const r = await TOOLS[tool].run(args, {
      conversation: id,
      subject,
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

// ------------------------------------------------------------------ the summary

describe("the registry's summary", () => {
  const text = renderCatalog(CATALOG);
  const lines = text.split("\n");

  it("says what a value means and which fine values a wider one covers, one line each", () => {
    expect(lines).toContain(
      "- body_region (the coarse form of body_part, each value covering the body_part values on its line below): head, spine, chest, other",
    );
    expect(lines).toContain(`  - head (covers body_part brain, brain-neck): ${HEAD}`);
    expect(lines).toContain(
      "  - spine (covers body_part spine, neck): the spine or the neck: any level of the spine, and imaging aimed at the neck's soft tissue or vessels (body_part splits it into spine and neck)",
    );
    expect(lines).toContain(
      "- body_part (the fine form of body_region): spine, neck, brain, brain-neck, chest, other",
    );
    expect(lines).toContain(`  - brain (within body_region head): ${BRAIN}`);
    // any axis: a described value of the technique
    expect(lines).toContain("  - SP-GRE: a spoiled gradient echo");
    // the line of an axis's values is the one it was, whatever is said under it
    expect(lines).toContain(
      "- technique: DWI-EPI, 3D-TSE, SS-TSE, TSE, MPRAGE, comb-ME-GRE, SP-GRE, Unknown",
    );
    expect(lines).toContain("- modifier (multi-valued, use has): FLAIR, FatSat, STIR");
  });

  it("writes a line only where the catalog says something, and never the other words of a value", () => {
    const under = lines.filter((l) => l.startsWith("  - "));
    // head, spine and other of the region; brain, brain-neck and other of the part; two techniques
    expect(under).toHaveLength(8);
    // a region that covers only its namesake and has no description, and a part with none: no line
    expect(under.some((l) => l.startsWith("  - chest"))).toBe(false);
    expect(under.some((l) => l.startsWith("  - neck"))).toBe(false);
    // the words a person knows a value by stay with the search
    for (const term of ["skull", "thorax", "SSFSE", "gadolinium", "MERGE", "also known as"])
      expect(text).not.toContain(term);
    // one line a value, and a description of many words is cut, with the search holding it whole
    const long = renderAxis({
      name: "technique",
      values: [{ id: "TSE", description: `a turbo spin echo\n${"and more words ".repeat(40)}` }],
    });
    expect(long).toHaveLength(2);
    expect(long[1].length).toBeLessThanOrEqual("  - TSE: ".length + MEANING_CHARS + 1);
    expect(long[1]).toMatch(/^ {2}- TSE: a turbo spin echo and more words .*…$/u);
  });

  it("grows by little: the sizes on a catalog that carries descriptions", () => {
    // as the facts carry it, on the fixture: 2,511 characters without the meanings, 3,929 with them
    const before = factsSummary(renderCatalog(OLDER)).length;
    const after = factsSummary(text).length;
    const said = (CATALOG.axes ?? []).flatMap((a) =>
      a.values.flatMap((v) => (v.description ? [v.description] : [])),
    );
    expect(said).toHaveLength(8);
    const descriptions = said.reduce((n, d) => n + d.length, 0);
    expect(after).toBeGreaterThan(before);
    // the descriptions themselves, and at most 60 characters a line for the value's name and its relation
    expect(after - before).toBeLessThanOrEqual(descriptions + 60 * said.length + 150);
    expect(after - before).toBeLessThan(1500);
    // the facts keep the lines as they are
    expect(factsSummary(text)).toContain(`  - brain (within body_region head): ${BRAIN}`);
  });

  it("reads as it did on an older registry's catalog", () => {
    const old = renderCatalog(OLDER);
    const axes = old
      .split("\n")
      .filter((l, i, all) => i > all.findIndex((x) => x.startsWith("Axes of a stack")) && l.startsWith("- "));
    expect(axes.slice(0, 7)).toEqual([
      "- base: DWI, SWI, T2starw, T2w, PDw, T1w",
      "- technique: DWI-EPI, 3D-TSE, SS-TSE, TSE, MPRAGE, comb-ME-GRE, SP-GRE, Unknown",
      "- modifier (multi-valued, use has): FLAIR, FatSat, STIR",
      "- post_contrast: given, not_given",
      "- disposition: acquisition, derived, scout",
      "- body_region: head, spine, chest, other",
      "- body_part: spine, neck, brain, brain-neck, chest, other",
    ]);
    expect(old.split("\n").some((l) => l.startsWith("  - "))).toBe(false);
    // and everything else of the summary is the same text
    const rest = (t: string) =>
      t
        .split("\n")
        .filter((l) => !l.startsWith("  - ") && !/^- body_(?:region|part)/u.test(l))
        .join("\n");
    expect(rest(text)).toBe(rest(old));
  });

  it("gives the scans' part with every axis whole", () => {
    const scans = partLines(text, "scans");
    expect(scans).toContain("- post_contrast: given, not_given");
    expect(scans).toContain(`  - brain (within body_region head): ${BRAIN}`);
    expect(scans.some((l) => l.startsWith("Cohorts"))).toBe(false);
    expect(partLines(text, "cohorts").every((l) => /cohort/iu.test(l))).toBe(true);
    expect(partLines(text, null)).toEqual(lines);
  });
});

// ------------------------------------------------------------------ the search

describe("a sorting value found by a person's word", () => {
  const at = (found: string[], start: string): number => found.findIndex((l) => l.startsWith(start));

  it("shows the head for brain, before the fine part of that name, each with what it means", () => {
    const found = searchCatalog(CATALOG, "brain");
    expect(found[0]).toBe(
      `scan sorting body_region = head, also known as brain (the wider value: covers body_part brain, brain-neck): ${HEAD}`,
    );
    expect(found[1]).toBe(
      `scan sorting body_part = brain (a fine value within body_region = head, the wider choice, which covers brain, brain-neck): ${BRAIN}`,
    );
    expect(at(found, "scan sorting body_part = brain-neck (a fine value within body_region = head")).toBe(2);
    expect(found).toHaveLength(3);
    // beside other words too, and for the plural
    for (const words of ["3D FLAIR brain scans", "brains", "all brain"]) {
      const some = searchCatalog(CATALOG, words);
      const head = at(some, "scan sorting body_region = head");
      expect(head, words).toBeGreaterThanOrEqual(0);
      expect(head, words).toBeLessThan(at(some, "scan sorting body_part = brain"));
    }
  });

  it("brings the wider value of a fine one the words found alone", () => {
    const found = searchCatalog(CATALOG, "brain-neck");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(
      /^scan sorting body_region = head \(the wider value: covers body_part brain, brain-neck\): /u,
    );
    expect(found[1]).toMatch(
      /^scan sorting body_part = brain-neck \(a fine value within body_region = head, the wider choice/u,
    );
    // a part whose region covers it alone has no wider choice to name
    expect(searchCatalog(CATALOG, "chest")).toEqual([
      "scan sorting body_region = chest",
      "scan sorting body_part = chest",
    ]);
  });

  it("finds a value by a maker's word, an earlier name and the words a person knows it by", () => {
    expect(searchCatalog(CATALOG, "MEDIC")).toEqual([
      "scan sorting technique = comb-ME-GRE (combMEGRE), also known as MEDIC",
    ]);
    expect(searchCatalog(CATALOG, "haste")).toEqual([
      "scan sorting technique = SS-TSE (SSTSE), also known as HASTE",
    ]);
    expect(searchCatalog(CATALOG, "flash")).toEqual([
      "scan sorting technique = SP-GRE (SPGRE), also known as FLASH: a spoiled gradient echo",
    ]);
    expect(searchCatalog(CATALOG, "gadolinium")).toEqual([
      "scan sorting post_contrast = given, also known as gadolinium",
    ]);
    expect(searchCatalog(CATALOG, "T2 star")).toContain(
      "scan sorting base = T2starw (T2*w), also known as T2*, T2 star",
    );
    expect(searchCatalog(CATALOG, "single shot TSE")).toContain(
      "scan sorting technique = SS-TSE (SSTSE), also known as single shot TSE",
    );
    expect(searchCatalog(CATALOG, "head and neck")).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^scan sorting body_part = brain-neck, also known as head and neck, head-neck \(/u,
        ),
      ]),
    );
    // an earlier stored word still finds the value
    expect(searchCatalog(CATALOG, "1")).toEqual([]);
    expect(
      sortingLine({ name: "post_contrast", values: [] }, { id: "given", label: "given", aliases: ["1"] }),
    ).toBe("scan sorting post_contrast = given");
  });

  it("finds a term by its whole words, never by a part of one or one word of several", () => {
    const value = { id: "X", terms: ["single shot TSE", "T1+C", "sense", "head and neck"] };
    expect(termsFound(value, ["single"])).toEqual([]);
    expect(termsFound(value, ["tse", "shot", "single"])).toEqual(["single shot TSE"]);
    expect(termsFound(value, ["t1"])).toEqual([]);
    expect(termsFound(value, ["se"])).toEqual([]);
    expect(termsFound(value, ["heads", "neck"])).toEqual(["head and neck"]);
    expect(termsFound({ id: "X" }, ["x"])).toEqual([]);
    // so T1 finds the weighting and not the contrast agent's T1+C
    expect(searchCatalog(CATALOG, "t1")).toEqual(["scan sorting base = T1w, also known as T1"]);
  });

  it("answers as it did on an older registry's catalog", () => {
    expect(searchCatalog(OLDER, "brain")).toEqual([
      "scan sorting body_part = brain",
      "scan sorting body_part = brain-neck",
    ]);
    // by the identity, the label and the axis's name, as before
    expect(searchCatalog(OLDER, "space")).toEqual(["scan sorting technique = 3D-TSE (SPACE)"]);
    expect(searchCatalog(OLDER, "post_contrast")).toEqual([
      "scan sorting post_contrast = given",
      "scan sorting post_contrast = not_given",
    ]);
    expect(searchCatalog(OLDER, "skull")).toEqual([]);
    expect(
      axisAbout((OLDER.axes ?? []).find((a) => a.name === "body_part") as never, OLDER.axes ?? []),
    ).toEqual([]);
    expect(searchCatalog(null, "brain")).toEqual([]);
  });

  it("is what registry_search answers, for words and for an axis looked up by its name", async () => {
    older = false;
    forgetPrelude();
    const t = turnOf("search-1", "How many scans are all brain?");
    const found = (await t.run("registry_search", { words: "brain" })) as { registry_data: string[] };
    expect(found.registry_data[0]).toMatch(/^scan sorting body_region = head, also known as brain /u);
    const axis = (await t.run("registry_search", { level: "stack", field: "body_part" })) as {
      registry_data: { sorting: string; values: string[]; about: string[] };
    };
    expect(axis.registry_data.sorting).toBe("body_part");
    expect(axis.registry_data.values).toEqual(["spine", "neck", "brain", "brain-neck", "chest", "other"]);
    expect(axis.registry_data.about[0]).toMatch(/^scan sorting body_region = spine \(the wider value/u);
    expect(axis.registry_data.about).toContain(
      `scan sorting body_part = brain (a fine value within body_region = head, the wider choice, which covers brain, brain-neck): ${BRAIN}`,
    );
    const scans = (await t.run("registry_summary", { part: "scans" })) as { registry_data: string };
    expect(scans.registry_data).toContain("  - head (covers body_part brain, brain-neck): the head:");
    // an older registry: the values alone, as before
    older = true;
    forgetPrelude();
    const old = turnOf("search-2", "How many scans are all brain?");
    expect(await old.run("registry_search", { words: "brain" })).toEqual({
      registry_data: ["scan sorting body_part = brain", "scan sorting body_part = brain-neck"],
    });
    expect(await old.run("registry_search", { level: "stack", field: "body_part" })).toEqual({
      registry_data: {
        sorting: "body_part",
        values: ["spine", "neck", "brain", "brain-neck", "chest", "other"],
      },
    });
    older = false;
    forgetPrelude();
  });
});

// ------------------------------------------------------------------ the warning

const FIRST =
  "Do not answer from this count yet, and give the person no reason for a small number: narrow_value means a filter names one fine value and kept a small share of the rows, while the values beside it under the same wider value hold most of the rest, so the filter is most likely narrower than the person's word. Unless the person's words ask for that one value alone (the fine part, or how far the scan reaches), write the clause the warning's fix gives, exactly as it is written and at the path it names, and draft the whole document again. Where they do ask for it alone, keep the document and say in the answer which value was counted.";
const AGAIN =
  "The warning narrow_value is still there after another draft: draft no more for it. Answer with what the question counted, and say in one plain sentence which value was counted and that the wider value the warning names holds more.";

describe("the warning of a filter narrower than the words", () => {
  it("reaches the model with its message and the clause to write, and sends it to draft again", async () => {
    const t = turnOf("narrow-1", "How many 3D FLAIR scans are all brain?");
    const out = await t.draft("name: narrow number 1\n");
    expect(out.document).toBe(41);
    expect(out.warnings).toEqual([
      { code: "narrow_value", path: NARROW.path, message: NARROW.message, fix: NARROW.next },
    ]);
    expect(out.about_warnings).toBe(FIRST);
    expect(t.turn.flawed).toEqual([{ document: 41, code: "narrow_value" }]);
    // an answer that rests on it is sent back before the turn settles, with the way out for the fine value
    expect(
      flawedComplaint(t.turn, "Only 31 scans are all brain, since a 3D FLAIR is rare (document 41)."),
    ).toBe(
      "document 41 was stored with the warning narrow_value: its filter names one fine value and kept a small share, where the wider value the warning names holds most of the rest. Unless the person's words ask for that one value alone, write the clause the warning's fix gave and draft it again, then answer from the new count; where they do, say in the answer which value was counted and that the wider one holds more",
    );
    // drafted again with the wider clause: no warning, and the answer on the new question is not held
    const wide = await t.draft("name: the head number 2\n");
    expect(wide.warnings).toBeUndefined();
    expect(wide.about_warnings).toBeUndefined();
    expect(flawedComplaint(t.turn, "3,931 scans are of the head (document 42).")).toBeNull();
  });

  it("is sent back once a turn, however many drafts carry it: nothing loops", async () => {
    const t = turnOf("narrow-2", "How many scans show the brain alone, without the neck?");
    const said: unknown[] = [];
    for (const n of [3, 4, 5, 6, 7]) said.push((await t.draft(`name: narrow number ${n}\n`)).about_warnings);
    expect(said).toEqual([FIRST, AGAIN, AGAIN, AGAIN, AGAIN]);
    expect(t.turn.sentBack.has("warning:narrow_value")).toBe(true);
    // the model kept the fine value and the warning came again: the check holds nothing, so the turn settles
    expect(flawedComplaint(t.turn, "31 scans show the brain alone (document 47).")).toBeNull();
    // a second clause or another path in the same turn is the same kind: still once
    const other = warningsNext(
      t.turn,
      48,
      warningsOf(diagnosis([{ ...NARROW, path: "sets.other.where[2]" }])),
    );
    expect(other).toBe(AGAIN);
    // three clauses of one document are one send-back
    const three = newTurn("narrow-3", "How many?");
    const paths = [0, 1, 2].map((i) => ({ ...NARROW, path: `sets.scans.where[${i}]` }));
    expect(warningsNext(three, 50, warningsOf(diagnosis(paths)))).toBe(FIRST);
    expect(three.flawed).toEqual([{ document: 50, code: "narrow_value" }]);
  });

  it("stands beside a warning that the count is wrong, each said once", async () => {
    const t = turnOf("narrow-4", "How many brain scans at least a year apart?");
    const out = await t.draft("name: narrow-and-reversed number 9\n");
    expect(String(out.about_warnings)).toMatch(/^Do not answer from this count: reversed_dates means /u);
    expect(String(out.about_warnings)).toContain(FIRST);
    expect(String(out.about_warnings)).not.toMatch(/Read the other warnings/u);
    expect(t.turn.flawed).toEqual([
      { document: 49, code: "reversed_dates" },
      { document: 49, code: "narrow_value" },
    ]);
    expect(flawedComplaint(t.turn, "None (document 49).")).toMatch(
      /^document 49 was stored with the warning reversed_dates, which means its count is not what was asked: .*; document 49 was stored with the warning narrow_value: /u,
    );
    // a clause for several wider values is passed on whole
    const several = {
      ...NARROW,
      next: 'to keep them all, write ["in",{},["axis",{},"body_region"],["head","spine"]] at sets.scans.where[0]; where only brain or neck is meant, change nothing',
    };
    expect(warningsOf(diagnosis([several]))[0].fix).toBe(several.next);
  });

  it("is absent from an older registry's diagnosis, which reads as it did", async () => {
    const t = turnOf("narrow-5", "How many scans are all brain?");
    const none = await t.draft("name: plain number 10\n");
    expect(none.document).toBe(50);
    expect(none.warnings).toBeUndefined();
    expect(none.about_warnings).toBeUndefined();
    // a diagnosis with no list of warnings at all
    const bare = await t.draft("name: no-list number 11\n");
    expect(bare.document).toBe(51);
    expect(bare.warnings).toBeUndefined();
    expect(bare.about_warnings).toBeUndefined();
    expect(t.turn.flawed).toEqual([]);
    expect(t.turn.sentBack.size).toBe(0);
    expect(flawedComplaint(t.turn, "31 scans (document 51).")).toBeNull();
    expect(warningsOf(diagnosis())).toEqual([]);
  });
});
