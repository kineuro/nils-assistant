// SPDX-License-Identifier: AGPL-3.0-only
// Words with two readings, read one way and held in the draft (2026-11-15,
// from live use). Two faults, each with made-up names and numbers:
// - a name that is a cohort's and a dataset's was asked of the dataset in
//   some chats and of the cohort in others. It is the cohort unless the
//   words say dataset; a draft against that is sent back before it reaches
//   the registry, once, with the shape to use, and a follow-up keeps the
//   reading of the turn before;
// - "at least five years apart" was counted between consecutive visits, and
//   the earlier day was put first in days_between. Apart is first to last
//   unless the words say consecutive; a draft with the visit before, or with
//   the days the wrong way round, is sent back once.
// The new worked examples were validated and run with the engine's own
// `ask validate` and `ask run` on its synthetic registry.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const dir = mkdtempSync(join(tmpdir(), "readings-"));
process.env.ASSISTANT_LEDGER = join(dir, "seam.sqlite");

const { stubEngine } = await import("./child/stub-engine.ts");
const { probeEngineAuth, registerStation } = await import("../src/seam/for.ts");
const { loadManifests } = await import("../src/stations/manifest.ts");
const { conversationOf, newTurn } = await import("../src/one/state.ts");
const { TOOLS } = await import("../src/one/tools.ts");
const { cohortSaidComplaint } = await import("../src/one/checks.ts");
const { cohortKeptNote, datasetNote } = await import("../src/one/datasets.ts");
const {
  CLOSEST_SHAPE,
  daysReversed,
  draftFaults,
  prevBesideHas,
  readDraft,
  readNames,
  SPAN_SHAPE,
  sendDraftBack,
  timeNote,
  timeReading,
} = await import("../src/one/readings.ts");
const { bodyFor, findExamples, loadSkills } = await import("../src/one/skills.ts");
const { closest } = await import("../src/stations/select.ts");
type DatasetFact = import("../src/one/datasets.ts").DatasetFact;
type Readings = import("../src/one/state.ts").TurnState["readings"];

const engine = await stubEngine((c) => {
  const p = c.path.split("?")[0];
  if (p === "/api/capabilities") return { body: { auth: "off", detail: "sensitive" } };
  if (p === "/api/ask/draft")
    return {
      body: { document: 61, hash: "h", diagnosis: { valid: true, issues: [], funnel: [] }, repairs: [] },
    };
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

const fact = (name: string, feeds: string[] | null = null): DatasetFact =>
  ({ name, state: null, subjects: 40, visits: 96, scans: 700, feeds, at: 0 }) as unknown as DatasetFact;
/** `study-a` is a cohort and a dataset; `study-b` is a dataset alone; `cohort-c` is a cohort alone. */
const LIST = [fact("study-a", ["study-a"]), fact("study-b", [])];
const COHORTS = ["study-a", "cohort-c"];

/** A count of the cohort's members with a FLAIR. */
const COHORT_DRAFT = `ast_version: 1
name: subjects of study-a with a FLAIR
scheme: default
sets:
  scope:  {grain: cohort, where: [["=", {}, ["field", {}, "name"], "study-a"]]}
  people: {grain: subject, of: scope}
  visits: {grain: session, of: people}
  flair:  {grain: stack, of: visits, where: [["has", {}, ["axis", {}, "modifier"], "FLAIR"]]}
  found:  {grain: subject, from: people, has: [{set: flair, min: 1}]}
keep: [found]
out: {set: found, level: count}
`;
/** The same count of what is stored in a dataset. */
const datasetDraft = (name: string): string => `ast_version: 1
name: subjects with a FLAIR stored in ${name}
scheme: default
sets:
  flair:
    grain: stack
    where:
      - ["=", {}, ["field", {}, "dataset"], "${name}"]
      - ["has", {}, ["axis", {}, "modifier"], "FLAIR"]
  found: {grain: subject, has: [{set: flair, min: 1}]}
keep: [found]
out: {set: found, level: count}
`;

type Output = Record<string, unknown>;
const drafts = (): number => engine.seen.filter((c) => c.path.startsWith("/api/ask/draft")).length;
/** One turn of a chat: its words read as the agent reads them, then a draft through the tool. */
function turnOf(id: string, message: string, follows = true) {
  const convo = conversationOf(id);
  const read = readNames(message, LIST, COHORTS, convo, follows);
  const turn = newTurn(id, message);
  turn.datasets = [...read.named, ...read.carried].map((x) => x.name);
  turn.readings = read.readings;
  const draft = async (text: string): Promise<Output> => {
    const r = await TOOLS.query_draft.run({ text }, {
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
  return { turn, read, draft };
}

describe("a name that is a cohort's and a dataset's, held in the draft", () => {
  it("sends back a draft of the dataset when the words do not say dataset, before it reaches the registry", async () => {
    const t = turnOf("shared-1", "How many subjects in study-a have a FLAIR?");
    expect(t.read.readings).toEqual([{ name: "study-a", as: "cohort", kept: false }]);
    // read as the cohort, the name is no dataset of the turn
    expect(t.turn.datasets).toEqual([]);
    const before = drafts();
    const out = await t.draft(datasetDraft("study-a"));
    expect(drafts()).toBe(before);
    expect(out).toEqual({
      refused: true,
      stored: false,
      why: "the draft was not sent to the registry: the draft narrows to the dataset study-a with the field dataset, and the person's words do not say dataset: study-a is a cohort and a dataset of the same name, and without the word dataset it is the cohort",
      next: 'Take out every clause on the field dataset that names study-a, and ask the cohort\'s members: the sets `scope: {grain: cohort, where: [["=", {}, ["field", {}, "name"], "study-a"]]}` and `people: {grain: subject, of: scope}`, with the sessions `of: people` and the scans `of` those sessions, as the worked examples show. Say in the answer, in one short clause, that the members of the cohort study-a were counted. Change only that and draft the whole document again.',
    });
    expect(t.turn.drafted).toEqual([]);
    // the shape it is told is the one the cohort draft has
    const doc = parse(COHORT_DRAFT) as { sets: Record<string, unknown> };
    expect(String(out.next)).toContain(
      `scope: {grain: cohort, where: [["=", {}, ["field", {}, "name"], "study-a"]]}`,
    );
    expect(doc.sets.people).toEqual({ grain: "subject", of: "scope" });
    // the cohort's members with a dataset clause beside them are sent back as well: never the other added
    const both = turnOf("shared-1b", "How many subjects in study-a have a FLAIR?");
    const added = COHORT_DRAFT.replace(
      'where: [["has", {}, ["axis", {}, "modifier"], "FLAIR"]]',
      'where: [["has", {}, ["axis", {}, "modifier"], "FLAIR"], ["=", {}, ["field", {}, "dataset"], "study-a"]]',
    );
    expect((await both.draft(added)).refused).toBe(true);
  });

  it("sends a fault back once: the same draft again goes to the registry, so it never loops", async () => {
    const t = turnOf("shared-2", "How many subjects in study-a have a FLAIR?");
    expect((await t.draft(datasetDraft("study-a"))).refused).toBe(true);
    const before = drafts();
    const again = await t.draft(datasetDraft("study-a"));
    expect(drafts()).toBe(before + 1);
    expect(again.document).toBe(61);
    expect(t.turn.drafted).toEqual([61]);
  });

  it("passes a draft of the dataset when the words say dataset", async () => {
    for (const [i, words] of [
      "How many subjects have a FLAIR stored in the dataset study-a?",
      "How many subjects of the study-a dataset have a FLAIR?",
      "In study-a, how many subjects does the dataset hold with a FLAIR?",
    ].entries()) {
      const t = turnOf(`shared-3-${i}`, words);
      expect(t.read.readings, words).toEqual([{ name: "study-a", as: "dataset", kept: false }]);
      expect(t.turn.datasets).toEqual(["study-a"]);
      const out = await t.draft(datasetDraft("study-a"));
      expect(out.refused, words).toBeUndefined();
      expect(out.document).toBe(61);
    }
  });

  it("passes a draft of the cohort when the words do not say dataset", async () => {
    const t = turnOf("shared-4", "How many subjects in study-a have a FLAIR?");
    const out = await t.draft(COHORT_DRAFT);
    expect(out.refused).toBeUndefined();
    expect(out.document).toBe(61);
    expect(t.turn.sentBack.size).toBe(0);
    // a cohort named by a parameter is read as well
    const byParam = COHORT_DRAFT.replace(
      "sets:",
      "params:\n  cohort: {type: cohort, value: study-a}\nsets:",
    ).replace('"name"], "study-a"]', '"name"], ["param", {}, "cohort"]]');
    expect(draftFaults(byParam, t.turn)).toEqual([]);
    const said = turnOf("shared-4b", "How many subjects of the dataset study-a have a FLAIR?");
    expect(draftFaults(byParam, said.turn).map((f) => f.key)).toEqual(["dataset:study-a"]);
  });

  it("sends back a draft of the cohort when the words say dataset", async () => {
    const t = turnOf("shared-5", "How many subjects have a FLAIR stored in the dataset study-a?");
    const before = drafts();
    const out = await t.draft(COHORT_DRAFT);
    expect(drafts()).toBe(before);
    expect(out.refused).toBe(true);
    expect(String(out.why)).toMatch(
      /the draft asks the cohort study-a by its name, and the person's words say dataset: study-a is a cohort and a dataset of the same name, and the words ask the dataset$/u,
    );
    expect(String(out.next)).toBe(
      'Take the cohort set named study-a out, with the sets drawn `of` it, and name the dataset in the `where` of the set that is counted: `["=", {}, ["field", {}, "dataset"], "study-a"]`, on sets with no cohort above them. Say in the answer, in one short clause, that the dataset study-a was counted. Change only that and draft the whole document again.',
    );
    // then the dataset's draft passes
    expect((await t.draft(datasetDraft("study-a"))).document).toBe(61);
  });

  it("leaves a name that is only a dataset, or only a cohort, untouched", async () => {
    const t = turnOf("shared-6", "How many subjects in study-b have a FLAIR?");
    expect(t.read.readings).toEqual([]);
    expect(t.turn.datasets).toEqual(["study-b"]);
    const out = await t.draft(datasetDraft("study-b"));
    expect(out.refused).toBeUndefined();
    expect(out.document).toBe(61);
    const c = turnOf("shared-6c", "How many subjects in cohort-c have a FLAIR?");
    expect(c.read.readings).toEqual([]);
    expect((await c.draft(COHORT_DRAFT.replaceAll('"study-a"', '"cohort-c"'))).document).toBe(61);
    // a name called both a cohort and a dataset is held to neither
    const both = turnOf("shared-6d", "In the study-a cohort, how many scans come from the study-a dataset?");
    expect(both.read.readings).toEqual([]);
    expect(both.turn.datasets).toEqual(["study-a"]);
  });

  it("keeps the first turn's reading in a follow-up that names nothing", async () => {
    // the cohort, kept
    const first = turnOf("shared-7", "How many subjects in study-a have a FLAIR?");
    expect((await first.draft(COHORT_DRAFT)).document).toBe(61);
    const next = turnOf("shared-7", "And how many of them have a 3D one?");
    expect(next.read.keptCohorts).toEqual(["study-a"]);
    expect(next.read.readings).toEqual([{ name: "study-a", as: "cohort", kept: true }]);
    expect(next.turn.datasets).toEqual([]);
    const before = drafts();
    const out = await next.draft(datasetDraft("study-a"));
    expect(drafts()).toBe(before);
    expect(String(out.why)).toMatch(
      /the person's words go on about the cohort named before and do not say dataset/u,
    );
    expect((await next.draft(COHORT_DRAFT)).document).toBe(61);
    expect(cohortKeptNote(next.read.keptCohorts)).toMatch(
      /Earlier in this conversation the words named study-a, read as the cohort .* keep the cohort's members, with no dataset clause/u,
    );
    // a third turn still keeps it; one that says dataset, or names another cohort, leaves it
    expect(turnOf("shared-7", "Only those from 2015 on.").read.keptCohorts).toEqual(["study-a"]);
    expect(turnOf("shared-7", "And how many of them are stored in the dataset?").read.readings).toEqual([]);
    expect(conversationOf("shared-7").cohorts).toEqual([]);
    turnOf("shared-7", "How many subjects in study-a have a FLAIR?");
    expect(turnOf("shared-7", "And in cohort-c?").read.readings).toEqual([]);

    // the dataset, kept
    const said = turnOf("shared-8", "How many subjects have a FLAIR stored in the dataset study-a?");
    expect((await said.draft(datasetDraft("study-a"))).document).toBe(61);
    const then = turnOf("shared-8", "And how many of them have a 3D one?");
    expect(then.turn.datasets).toEqual(["study-a"]);
    expect(then.read.readings).toEqual([{ name: "study-a", as: "dataset", kept: true }]);
    const sent = await then.draft(COHORT_DRAFT);
    expect(sent.refused).toBe(true);
    expect(String(sent.why)).toMatch(/the person's words go on about the dataset named before/u);
    expect((await then.draft(datasetDraft("study-a"))).document).toBe(61);
    // words that turn to the cohort leave the dataset
    expect(turnOf("shared-8", "And in the cohort?").read.readings).toEqual([]);
    // a name called both is kept as both, and held to neither
    turnOf("shared-9", "In the study-a cohort, how many scans come from the study-a dataset?");
    const after = turnOf("shared-9", "And how many of them are 3D?");
    expect(after.turn.datasets).toEqual(["study-a"]);
    expect(after.read.readings).toEqual([]);
  });

  it("is said in the hint of a turn that says dataset", () => {
    expect(datasetNote([])).toBe("");
    expect(datasetNote(["study-a"])).toMatch(
      /say dataset of study-a, also a cohort's name: the question names the dataset with the field dataset, with no cohort set of that name/u,
    );
  });

  it("is said in the answer: the cohort's members were counted", () => {
    const t = turnOf("shared-10", "How many subjects in study-a have a FLAIR?").turn;
    t.drafted.push(61);
    expect(cohortSaidComplaint(t, "9 subjects have a FLAIR (document 61).")).toMatch(
      /study-a is a cohort and a dataset of the same name.*say so in one short clause \(the members of the cohort study-a\)/u,
    );
    for (const said of [
      "9 members of the cohort study-a have a FLAIR (document 61).",
      "9 subjects have a FLAIR, counted among the cohort's members (document 61).",
    ])
      expect(cohortSaidComplaint(t, said), said).toBeNull();
    // nothing drafted, a follow-up, a dataset said, or no shared name: not asked
    const none = turnOf("shared-11", "How many subjects in study-a have a FLAIR?").turn;
    expect(cohortSaidComplaint(none, "I could not draft that.")).toBeNull();
    const kept = turnOf("shared-10", "And how many of them are 3D?").turn;
    kept.drafted.push(62);
    expect(cohortSaidComplaint(kept, "4 of them (document 62).")).toBeNull();
    const ds = turnOf("shared-12", "How many subjects are stored in the dataset study-a with a FLAIR?").turn;
    ds.drafted.push(63);
    expect(cohortSaidComplaint(ds, "9 subjects (document 63).")).toBeNull();
  });
});

const COOKBOOK = "stations/ask-help/cookbook";
const example = (f: string): string => readFileSync(`${COOKBOOK}/${f}`, "utf8");
const NO_READINGS: Readings = [];
const asked = (message: string) => ({ message, readings: NO_READINGS, sentBack: new Set<string>() });
/** The draft the live chat wrote: each visit against the one before, the earlier day first. */
const PREV_DRAFT = `ast_version: 1
name: subjects with FLAIR scans five years apart
scheme: default
sets:
  flair:  {grain: stack, where: [["has", {}, ["axis", {}, "modifier"], "FLAIR"]]}
  visits: {grain: session, has: [{set: flair, min: 1}]}
  gaps:
    grain: session
    from: visits
    bind:
      gap: ["days_between", {}, ["prev", {}, ["field", {}, "first"]], ["field", {}, "first"]]
  far:    {grain: session, from: gaps, where: [[">=", {}, ["field", {}, "gap"], 1830]]}
  found:  {grain: subject, has: [{set: far, min: 1}]}
keep: [found]
out: {set: found, level: count}
`;
const RIGHT_WAY = PREV_DRAFT.replace(
  '["prev", {}, ["field", {}, "first"]], ["field", {}, "first"]]',
  '["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]]',
);

describe("how far apart in time", () => {
  it("is first to last unless the words say consecutive", () => {
    for (const words of [
      "How many subjects have FLAIR scans at least five years apart?",
      "Which subjects have T1 scans spanning ten years or more?",
      "How many subjects have a follow-up of at least 3 years with an MPRAGE?",
      "How many subjects were followed for five years or more?",
    ])
      expect(timeReading(words), words).toBe("span");
    for (const words of [
      "How many subjects have consecutive FLAIR scans at least five years apart?",
      "Which subjects have a gap of more than two years?",
      "Which successive sessions are six months apart?",
      "How many subjects have more than a year between visits?",
      "What is the longest interval between sessions, in days?",
      "How many days since the previous session, per subject?",
    ])
      expect(timeReading(words), words).toBe("consecutive");
    for (const words of [
      "How many subjects have a FLAIR?",
      "How many sessions since 2015 hold an MPRAGE?",
      "Which subjects have sessions in two consecutive protocols?",
    ])
      expect(timeReading(words), words).toBeNull();
  });

  it("is said in the hint, with the order of the two days and that the answer states the reading", () => {
    expect(timeNote(null)).toBe("");
    expect(timeNote("span")).toMatch(
      /do not say consecutive: read it per subject from the earliest to the latest visit that holds what is asked, never against the visit before/u,
    );
    expect(timeNote("span")).toMatch(/its first day minus its second, so the later day goes first/u);
    expect(timeNote("span")).toMatch(/Say the reading in the answer in a few words/u);
    expect(timeNote("consecutive")).toMatch(/each visit against the one before it/u);
    expect(timeNote("consecutive")).toMatch(/Say the reading in the answer in a few words/u);
  });

  it("sends back, once, a draft with the visit before when the words say apart", async () => {
    const t = turnOf("apart-1", "How many subjects have FLAIR scans at least five years apart?");
    const before = drafts();
    const out = await t.draft(RIGHT_WAY);
    expect(drafts()).toBe(before);
    expect(out).toEqual({
      refused: true,
      stored: false,
      why: "the draft was not sent to the registry: the draft measures each visit against the one before it (`prev`), and the person's words ask how far apart, so far or more, without saying consecutive: that is each subject's earliest to latest visit that holds what is asked",
      next: `Take \`prev\` out and use ${SPAN_SHAPE}. Write a length in years as whole days of 365.25 a year (five years are 1826). Say in the answer, in a few words, that it is from the first to the last such visit. Change only that and draft the whole document again.`,
    });
    // once: the same reading again goes on, and the first-to-last draft passes with nothing said
    expect((await t.draft(RIGHT_WAY)).document).toBe(61);
    const span = turnOf("apart-2", "How many subjects have FLAIR scans at least five years apart?");
    expect((await span.draft(example("first-to-last-span-a.ask.yml"))).document).toBe(61);
    expect(span.turn.sentBack.size).toBe(0);
  });

  it("passes the visit before when the words say consecutive, a gap or between visits", () => {
    for (const words of [
      "How many subjects have consecutive FLAIR scans at least five years apart?",
      "Which subjects have a gap of at least five years between FLAIR scans?",
      "How many days passed between their first and their second session?",
    ])
      expect(draftFaults(RIGHT_WAY, asked(words)), words).toEqual([]);
  });

  it("sends back a draft with the earlier day first, whatever the words", () => {
    // the visit before, first
    expect(daysReversed(readDraft(PREV_DRAFT) ?? {})).toBe(true);
    expect(daysReversed(readDraft(RIGHT_WAY) ?? {})).toBe(false);
    const consecutive = asked("Which subjects have a gap of at least five years between FLAIR scans?");
    const back = sendDraftBack(PREV_DRAFT, consecutive);
    expect(back?.why).toMatch(
      /takes days_between with the earlier day first; it is its first day minus its second, so every row gets zero or less/u,
    );
    expect(back?.next).toContain(
      '`["days_between", {}, ["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]]`',
    );
    expect(sendDraftBack(PREV_DRAFT, consecutive)).toBeNull();
    // the earliest of a column before its latest, bound by name or written in place
    const span = example("first-to-last-span-a.ask.yml");
    const swapped = span.replace(
      '["field", {}, "last_day"], ["field", {}, "first_day"]]',
      '["field", {}, "first_day"], ["field", {}, "last_day"]]',
    );
    expect(swapped).not.toBe(span);
    expect(daysReversed(readDraft(span) ?? {})).toBe(false);
    expect(daysReversed(readDraft(swapped) ?? {})).toBe(true);
    // both faults of the live draft are told in one answer
    const live = sendDraftBack(
      PREV_DRAFT,
      asked("How many subjects have FLAIR scans at least five years apart?"),
    );
    expect(live?.why).toMatch(
      /earlier day first.*; and the draft measures each visit against the one before/u,
    );
    // text that is no document is the registry's to answer
    expect(draftFaults("sets: [", asked("five years apart"))).toEqual([]);
    expect(draftFaults("name: three-keys\n", asked("five years apart"))).toEqual([]);
  });
});

describe("less than so far apart", () => {
  const CLOSE = "How many subjects have two sessions holding a FLAIR less than 180 days apart?";
  /** The closest pair as the worked example asks it: the gap bound in a set drawn from the sessions that hold it. */
  const close = () => example("two-sessions-close-a.ask.yml");
  /** The same words answered first to last, which counts how far apart at most. */
  const spanned = () => example("first-to-last-span-a.ask.yml").replace('[">=", {}', '["<", {}');

  it("is the closest pair, a visit and the one before it, and never first to last", () => {
    for (const words of [
      CLOSE,
      "How many subjects have two FLAIR sessions within six months of each other?",
      "Which subjects have two sessions at most a year apart?",
      "How many subjects have two sessions no more than 90 days apart?",
      "Which subjects have scans closer than 30 days apart?",
    ])
      expect(timeReading(words), words).toBe("closest");
    // a length as the least, or said bare, is first to last: "five years apart" means so far apart or more
    for (const words of [
      "How many subjects have FLAIR scans at least five years apart?",
      "How many subjects have FLAIR scans more than a year apart?",
      "How many subjects have FLAIR scans five years apart?",
      "How many subjects have FLAIR scans five years or more apart?",
    ])
      expect(timeReading(words), words).toBe("span");
    // no length to tell the reading from, a least and a most together, or a most said of something else: no reading
    for (const words of [
      "How far apart are their scans?",
      "Which subjects have sessions four to five years apart, each with a score within a year of its date?",
      "How many subjects have scans more than one year and less than two years apart?",
      "How many subjects under 30 years have scans five years apart?",
      "How many sessions holding a FLAIR are within 90 days of a session holding an MPRAGE?",
    ])
      expect(timeReading(words), words).toBeNull();
    expect(timeNote("closest")).toMatch(
      /two visits less than so far apart: the closest pair, which is a visit and the one before it among those that hold what is asked/u,
    );
    expect(timeNote("closest")).toMatch(
      /`<` for less than and `<=` for within or at most; never the earliest to the latest/u,
    );
    expect(timeNote("closest")).toMatch(
      /Say the reading in the answer in a few words \(two such visits less than so many days apart\)/u,
    );
  });

  it("passes a draft with the visit before untouched, through the tool", async () => {
    for (const [i, words] of [
      CLOSE,
      "How many subjects have two FLAIR sessions within six months of each other?",
    ].entries()) {
      const t = turnOf(`close-1-${i}`, words);
      const before = drafts();
      const out = await t.draft(close());
      expect(drafts(), words).toBe(before + 1);
      expect(out.refused, words).toBeUndefined();
      expect(out.document).toBe(61);
      expect(t.turn.sentBack.size).toBe(0);
    }
    // every worked example with a length of time passes under its own question
    for (const f of [
      "first-to-last-span-a.ask.yml",
      "consecutive-sessions-apart-b.ask.yml",
      "two-sessions-close-a.ask.yml",
      "first-to-second-gap-b.ask.yml",
      "session-pairs.ask.yml",
      "two-sessions-one-year.ask.yml",
      "kind-near-another-kind.ask.yml",
      "sessions-since-date-with-kind.ask.yml",
      "diagnostic-window.ask.yml",
    ]) {
      const raw = example(f);
      const question = /^# question: (.*)$/mu.exec(raw)?.[1] ?? "";
      expect(question, f).not.toBe("");
      expect(draftFaults(raw, asked(question)), f).toEqual([]);
    }
  });

  it("sends back, once, a draft that measures first to last, with the closest-pair shape", async () => {
    const t = turnOf("close-2", CLOSE);
    const before = drafts();
    const out = await t.draft(spanned());
    expect(drafts()).toBe(before);
    expect(out).toEqual({
      refused: true,
      stored: false,
      why: "the draft was not sent to the registry: the draft measures from each subject's earliest to latest visit, and the person's words ask for two visits less than so far apart: a subject seen often over many years has two close visits and a long way from first to last, so the closest pair is asked, a visit and the one before it",
      next: `Take the group with the earliest and the latest day out and use ${CLOSEST_SHAPE}. Compare with \`<\` for less than and \`<=\` for within or at most. Say in the answer, in a few words, that it is two such visits less than so many days apart. Change only that and draft the whole document again.`,
    });
    expect((await t.draft(spanned())).document).toBe(61);
    // the shape it is told is the worked example's own
    const flat = (s: string) => s.replace(/\s+/gu, " ");
    for (const part of [
      'gap: ["days_between", {}, ["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]]',
      "has: [{set: close, min: 1}]",
      "out: {set: found, level: count}",
    ]) {
      expect(CLOSEST_SHAPE).toContain(part);
      expect(flat(close())).toContain(part);
    }
    // first to last stays right for a length as the least, and for words with no reading
    expect(
      draftFaults(example("first-to-last-span-a.ask.yml"), asked("FLAIR scans at least five years apart?")),
    ).toEqual([]);
    expect(draftFaults(spanned(), asked("How far apart are their scans?"))).toEqual([]);
  });

  it("sends back, once, the visit before bound beside the has, where it is any visit of the subject", () => {
    const beside = close()
      .replace("    has: [{set: flair, min: 1}]\n", "")
      .replace(
        "    from: holding\n    bind:",
        "    from: holding\n    has: [{set: flair, min: 1}]\n    bind:",
      );
    expect(prevBesideHas(readDraft(close()) ?? {})).toEqual([]);
    expect(prevBesideHas(readDraft(beside) ?? {})).toEqual(["close"]);
    const turn = asked(CLOSE);
    const back = sendDraftBack(beside, turn);
    expect(back?.why).toBe(
      "the draft was not sent to the registry: the set close binds the visit before (`prev`) beside its `has`: there the one before is any visit of the subject, also one that does not hold what is asked",
    );
    expect(back?.next).toContain("from: close, bind: {gap: [");
    expect(sendDraftBack(beside, turn)).toBeNull();
    // held for consecutive words too, and for no others
    expect(
      draftFaults(beside, asked("Which consecutive FLAIR sessions are less than 180 days apart?")).map(
        (f) => f.key,
      ),
    ).toEqual(["prev-beside-has"]);
    expect(draftFaults(beside, asked("How many subjects have a FLAIR?"))).toEqual([]);
  });
});

describe("the find-data skill and its worked examples, for these readings", () => {
  const skill = loadSkills(["./stations"], ["find-data"]).get("find-data");
  if (!skill) throw new Error("the find-data skill is missing");
  const examples = findExamples(["./stations"]);
  const NEW = [
    "first-to-last-span-a.ask.yml",
    "consecutive-sessions-apart-b.ask.yml",
    "sessions-since-date-with-kind.ask.yml",
    "kind-near-another-kind.ask.yml",
    "two-sessions-close-a.ask.yml",
  ];
  type Doc = {
    sets: Record<string, Record<string, unknown>>;
    out: { set: string; level: string };
  };

  it("carries the rules", () => {
    const b = skill.body;
    expect(b).toMatch(
      /\*\*A name that is a cohort's and a dataset's\*\* is the cohort, unless the words say dataset/u,
    );
    expect(b).toContain('`scope: {grain: cohort, where: [["=", {}, ["field", {}, "name"], "X"]]}`');
    expect(b).toContain("`people: {grain: subject, of: scope}`");
    expect(b).toMatch(/the answer says in one short clause that the cohort's members were counted/u);
    expect(b).toMatch(/A follow-up keeps the reading of the turn before/u);
    expect(b).toMatch(
      /\*\*Apart\*\*, \*\*a span of\*\*, \*\*a follow-up of at least\*\* .* from the earliest to the latest visit that holds what is asked/u,
    );
    expect(b).toMatch(
      /Only when the words say \*\*consecutive\*\*, \*\*successive\*\*, \*\*between visits\*\*, \*\*a gap\*\* or \*\*an interval between\*\*/u,
    );
    expect(b).toMatch(/`days_between` is its first day minus its second: the later day goes first/u);
    expect(b).toMatch(
      /\*\*Less than\*\* so far apart, \*\*within N of each other\*\*, \*\*at most\*\* .* is the closest pair, never first to last/u,
    );
    expect(b).toMatch(/bound beside the `has`, the one before is any visit of the subject/u);
    expect(b).toMatch(/`<` for less than and `<=` for within or at most/u);
    expect(b).toMatch(/five 1826/u);
    expect(b).toMatch(/The answer says the reading in a few words/u);
  });

  it("is backed by five worked examples in the cookbook's made-up names, which no check sends back", () => {
    for (const f of NEW) {
      const raw = example(f);
      const question = /^# question: (.{40,})$/mu.exec(raw)?.[1] ?? "";
      expect(question, f).not.toBe("");
      expect(raw, f).toMatch(/^# synthetic: /mu);
      const doc = parse(raw) as Doc;
      expect(Object.keys(doc.sets), f).toContain(doc.out.set);
      expect(raw, f).not.toMatch(/"dataset"/u);
      // an example is never sent back for the question it answers
      expect(draftFaults(raw, asked(question)), f).toEqual([]);
    }
    // first to last: each day bound by itself, the later first, five years as 1826 days, counted
    const span = parse(example(NEW[0])) as Doc;
    expect(span.sets.spans).toEqual({
      grain: "group",
      group: { of: "holding", by: [["field", {}, "subject.code"]] },
      bind: {
        first_day: ["min", { set: "holding" }, ["field", {}, "first"]],
        last_day: ["max", { set: "holding" }, ["field", {}, "first"]],
      },
      where: [[">=", {}, ["days_between", {}, ["field", {}, "last_day"], ["field", {}, "first_day"]], 1826]],
    });
    expect(span.out).toEqual({ set: "spans", level: "count" });
    expect(example(NEW[0])).not.toMatch(/"prev"/u);
    // the shape a draft is sent back with is the example's own
    const flat = (s: string) => s.replace(/\s+/gu, " ");
    for (const part of [
      'group: {of: holding, by: [["field", {}, "subject.code"]]}',
      'first_day: ["min", {set: holding}, ["field", {}, "first"]]',
      'last_day: ["max", {set: holding}, ["field", {}, "first"]]',
      '["days_between", {}, ["field", {}, "last_day"], ["field", {}, "first_day"]]',
      "out: {set: spans, level: count}",
    ]) {
      expect(SPAN_SHAPE).toContain(part);
      expect(flat(example(NEW[0]))).toContain(part);
    }
    // consecutive: the visit's day, then the one before
    const gap = parse(example(NEW[1])) as Doc;
    expect(gap.sets.visits.bind).toEqual({
      gap: ["days_between", {}, ["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]],
    });
    expect(gap.sets.far.where).toEqual([[">=", {}, ["field", {}, "gap"], 183]]);
    // the closest pair: the sessions that hold it, the gap bound in a set drawn from them, the subjects that have one
    const two = parse(example(NEW[4])) as Doc;
    expect(two.sets.holding).toEqual({ grain: "session", from: "visits", has: [{ set: "flair", min: 1 }] });
    expect(two.sets.close).toEqual({
      grain: "session",
      from: "holding",
      bind: { gap: ["days_between", {}, ["field", {}, "first"], ["prev", {}, ["field", {}, "first"]]] },
      where: [["<", {}, ["field", {}, "gap"], 400]],
    });
    expect(two.sets.found).toEqual({ grain: "subject", from: "people", has: [{ set: "close", min: 1 }] });
    expect(two.out).toEqual({ set: "found", level: "count" });
    // since a date, with the subjects in the same count
    const since = parse(example(NEW[2])) as Doc;
    expect(since.sets.recent).toEqual({
      grain: "session",
      has: [{ set: "mprage", min: 1 }],
      where: [[">=", {}, ["field", {}, "first"], "2015-01-01"]],
    });
    expect(since.out).toEqual({ set: "recent", level: "count" });
    // one kind within days of another kind's session
    const near = parse(example(NEW[3])) as Doc;
    expect(near.sets.close.near).toEqual([
      {
        as: "other",
        set: "with_mprage",
        window: { from: -90, to: 90, unit: "day" },
        policy: "nearest",
        tie: "earlier",
      },
    ]);
  });

  it("puts them in front of the questions they answer", () => {
    const first = (q: string) => closest(q, examples, 3)[0]?.file;
    const live = "How many subjects have 3D FLAIR scans at least five years apart?";
    expect(first(live)).toBe("first-to-last-span-a.ask.yml");
    expect(bodyFor(skill, live, examples)).toContain(
      'last_day:  ["max", {set: holding}, ["field", {}, "first"]]',
    );
    expect(first("Which consecutive sessions of cohort A are at least three months apart?")).toBe(
      "consecutive-sessions-apart-b.ask.yml",
    );
    expect(first("How many subjects have two sessions holding an MPRAGE less than 180 days apart?")).toBe(
      "two-sessions-close-a.ask.yml",
    );
    expect(first("How many sessions since 2018 hold a TSE, and how many subjects?")).toBe(
      "sessions-since-date-with-kind.ask.yml",
    );
    expect(
      first(
        "How many sessions with a TSE are within 30 days of a session with an MPRAGE of the same subject?",
      ),
    ).toBe("kind-near-another-kind.ask.yml");
  });
});
