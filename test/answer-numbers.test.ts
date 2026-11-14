// SPDX-License-Identifier: AGPL-3.0-only
// Answers that hold from one run to the next. The same questions asked
// several times gave a right number on one try and a wrong one on the next,
// each time by the model's choice and never by the registry's. Each part
// below holds one of the faults found, with made-up numbers; a right answer
// is never sent back for what it says.

import { describe, expect, it } from "vitest";
import { complaintsOf, countComplaint, uncountedComplaint } from "../src/one/checks.ts";
import { cohortNote, cohortsMeant, type DatasetFact } from "../src/one/datasets.ts";
import { countsNotGiven, countsStated, given, noteNumbers } from "../src/one/numbers.ts";
import { carryNumbers, conversationOf, newTurn } from "../src/one/state.ts";
import { cutNote } from "../src/one/tools.ts";
import { unplainWords } from "../src/one/words.ts";

/** What a draft answered, as the model reads it: the stage counts, a drop and the count. */
const RESULT = {
  document: 412,
  diagnosis: {
    funnel: [
      { set: "people", stage: "source", rows: 1204, subjects: 1204 },
      { set: "visits", stage: "source", rows: 5310, subjects: 1204 },
      { set: "both", stage: "has flair", rows: 2644, subjects: 914 },
      { set: "answer", stage: "has both", rows: 632, subjects: 632 },
    ],
    drops: [{ set: "answer", clause: "has both", before: 914, after: 632, nulls: 0 }],
  },
  preview: { registry_data: { level: "count", columns: ["rows", "subjects"], rows: [[632, 632]] } },
};
const known = (...more: unknown[]): Set<number> => {
  const k = new Set<number>();
  noteNumbers(k, [RESULT, ...more]);
  return k;
};

describe("the numbers a turn was given", () => {
  it("reads them from a result's values, its text and a text that is JSON", () => {
    const k = new Set<number>();
    noteNumbers(k, { a: 1204, b: ["5,310 visits", { c: 2644.0 }], d: '{"rows":[[632,17]]}', e: null });
    for (const n of [1204, 5310, 2644, 632, 17]) expect(k.has(n), String(n)).toBe(true);
    // a number grouped in thousands in a text is the whole and, as a row of values may be, its parts
    expect(k.has(5)).toBe(true);
    expect(k.has(310)).toBe(true);
    expect(k.has(12045310)).toBe(false);
  });

  it("takes a number as given when it is one, or the sum or the difference of two", () => {
    const k = known();
    expect(given(914, k)).toBe(true);
    expect(given(282, k)).toBe(true); // 914 - 632
    expect(given(1546, k)).toBe(true); // 914 + 632
    expect(given(777, k)).toBe(false);
    // never by a small number, which every result holds: 632 + 4 is no count that was given
    k.add(4);
    expect(given(636, k)).toBe(false);
  });
});

describe("the counts an answer states", () => {
  const stated = (a: string) => countsStated(a).map((c) => c.n);

  it("finds whole numbers of three or more digits said of things counted", () => {
    expect(stated("**632 subjects** have both, out of 1,204 members and 5,310 visits.")).toEqual([
      632, 1204, 5310,
    ]);
    expect(stated("That is 2,644 such sessions in all.")).toEqual([2644]);
    expect(stated("There are 3,470 subject-and-scanner pairs and 14 groups.")).toEqual([3470]);
    expect(stated("**282** of those have theirs on two scanners; 632 of the 914 subjects do not.")).toEqual([
      282, 632, 914,
    ]);
  });

  it("leaves out what is no count", () => {
    for (const plain of [
      "The question is stored as document 412, and question 413 lists the subjects.",
      "In 2011 sessions with a FLAIR were most common.",
      "Counted for subjects with at least 100 sessions, or 250 or more scans.",
      "About 1,200 subjects, roughly 5,300 visits and ~900 scans qualify.",
      "It holds 52.5% of the 1.2 mm scans, 176 slices each, at 3.0 tesla.",
      "A T1 of 256 by 256 voxels, 1000 ms apart.",
      "Version 318 of the sorting, run 204, job 3301.",
      "Fewer than 500 subjects, and over 2,500 visits.",
      // grouped with a plain space, a number is not read in parts
      "It counts 12 345 subjects in 2 580 sessions.",
    ])
      expect(stated(plain), plain).toEqual([]);
  });
});

describe("a count no result of the turn holds", () => {
  it("is named once, in the answer's own words", () => {
    const why = countComplaint(
      "**632 subjects** have at least two such sessions, 4,721 such sessions in all; 4,721 sessions is many.",
      known(),
    );
    expect(why).toMatch(/"4,721 such sessions"/u);
    expect(why?.match(/4,721/gu)?.length).toBe(1);
    expect(why).toMatch(/no result of this turn holds/u);
    expect(why).toMatch(/another question/u);
    // two of them are named together
    expect(countComplaint("777 subjects in 4,721 sessions.", known())).toMatch(
      /"777 subjects", "4,721 sessions"/u,
    );
  });

  it("never sends back an answer whose numbers the turn was given", () => {
    const facts = "## What the registry holds\nCohorts (by name): ms-cohort-b (1204 members)";
    const words = "How many subjects have at least 3 sessions since 2012, of the 3,300 we enrolled?";
    const k = known(facts, words);
    for (const right of [
      // the count, the stage counts and a drop
      "**632 subjects** of the 1,204 in the cohort have three such sessions (document 412); 914 subjects have one, across 2,644 sessions.",
      // the other part, worked out from two numbers given
      "632 of the 914 subjects qualify; the other 282 subjects have fewer sessions.",
      "Together that is 1,546 subjects counted twice over.",
      // the person's own numbers, a year, a threshold, a share, a rounded figure, a document's number
      "Of the 3,300 subjects you enrolled, 632 subjects have at least 3 sessions since 2012: about 19%, roughly 630 subjects.",
      "632 subjects (52.5%) have 3 or more sessions; the question is document 412.",
      // rows written as a list
      "- 632 subjects with both\n- 914 subjects with a FLAIR\n- 5,310 sessions in all",
      // no number at all
      "No subject has such a session.",
    ])
      expect(countComplaint(right, k), right).toBeNull();
  });

  it("is checked before a turn that found data settles, and only there", async () => {
    const id = "num-1";
    const t = newTurn(id, "How many subjects have three such sessions?");
    t.skills.add("find-data");
    t.tools.push("query_draft");
    t.drafted.push(412);
    noteNumbers(t.known, RESULT);
    const c = { turn: t, convo: conversationOf(id), conversation: id, validate: null };
    t.texts.push("632 subjects have three such sessions (document 412).");
    expect(await complaintsOf(c)).toEqual([]);
    t.texts[0] = "632 subjects have three such sessions, 4,721 such sessions in all (document 412).";
    expect((await complaintsOf(c)).join(" ")).toMatch(/"4,721 such sessions"/u);
    // a turn that worked numbers out in its workspace states numbers no tool result holds
    t.tools.push("analysis_table");
    expect(await complaintsOf(c)).toEqual([]);
    t.tools.pop();
    // a conversation whose earlier turns this process did not see is not held to them
    conversationOf(id).unseen = true;
    expect(await complaintsOf(c)).toEqual([]);
    conversationOf(id).unseen = false;
    // a turn that found no data is not checked
    const other = newTurn("num-2", "Thanks!");
    other.texts.push("There were 4,721 sessions, as I said.");
    expect(
      await complaintsOf({
        turn: other,
        convo: conversationOf("num-2"),
        conversation: "num-2",
        validate: null,
      }),
    ).toEqual([]);
  });

  it("lets a follow-up state a number an earlier turn of the conversation was given or said", async () => {
    const id = "num-3";
    const first = newTurn(id, "How many subjects have three such sessions?");
    noteNumbers(first.known, RESULT);
    first.texts.push("632 subjects; the other 282 subjects have fewer (document 412).");
    carryNumbers(id, false);
    const t = newTurn(id, "And how many of them are women?");
    t.skills.add("find-data");
    t.drafted.push(413);
    noteNumbers(t.known, { document: 413, preview: { rows: [[377, 377]] } });
    t.texts.push("377 of those 632 subjects are women, and of the other 282 subjects none (document 413).");
    const c = { turn: t, convo: conversationOf(id), conversation: id, validate: null };
    expect(await complaintsOf(c)).toEqual([]);
    expect(conversationOf(id).unseen).toBe(false);
    // told its facts before, in a process that saw no turn of it: its earlier numbers are not known here
    carryNumbers("num-4", true);
    expect(conversationOf("num-4").unseen).toBe(true);
  });

  it("names each number once however often the answer says it", () => {
    expect(countsNotGiven("777 subjects, again 777 subjects.", known()).map((c) => c.n)).toEqual([777]);
  });
});

describe("an answer whose steps were not counted", () => {
  it("says the steps could not be counted and the number is unchecked", () => {
    const t = newTurn("cut-1", "How many subjects?");
    t.drafted.push(41);
    t.uncounted.push(41);
    expect(uncountedComplaint(t, "632 subjects have both (document 41).")).toMatch(
      /steps of document 41 could not be counted in the time/u,
    );
    for (const said of [
      "632 subjects have both (document 41). The steps could not be counted in the time, so this is the question's own count, unchecked step by step.",
      "632 subjects (document 41); I could not check it step by step in the time.",
      "Document 41 counts 632 subjects. That number was not checked stage by stage: the time ran out.",
      // as a chat wrote it, and was sent back for it: a hyphened word and a shortened not
      "632 subjects (document 41). That count is the question's own; the step-by-step breakdown ran past the time limit, so it isn't checked stage by stage.",
      "632 subjects (document 41), which I couldn't check step by step.",
    ])
      expect(uncountedComplaint(t, said), said).toBeNull();
  });

  it("holds only the question the answer keeps, and none counted whole", () => {
    const t = newTurn("cut-2", "How many subjects?");
    t.drafted.push(41, 42);
    t.uncounted.push(41);
    // the answer keeps document 42, whose steps were counted
    expect(uncountedComplaint(t, "632 subjects have both (document 42).")).toBeNull();
    // an answer of two numbers names both questions: the one left uncounted is held, wherever it is named
    expect(
      uncountedComplaint(t, "914 subjects (document 42), and 632 of them on one scanner (document 41)."),
    ).toMatch(/steps of document 41 could not be counted/u);
    const whole = newTurn("cut-3", "How many subjects?");
    whole.drafted.push(43);
    expect(uncountedComplaint(whole, "632 subjects have both (document 43).")).toBeNull();
  });

  it("is told by the tool's own note beside the answer", () => {
    const note = cutNote({ parts: ["funnel", "drops"], budget_ms: 5000 }, true);
    expect(note).toMatch(/say in the answer that the steps could not be counted in the time/u);
    expect(note).toMatch(/unchecked step by step/u);
    expect(note).not.toMatch(/only if asked/u);
  });
});

describe("a name that is a cohort's and a dataset's", () => {
  const fact = (name: string, feeds: string[] | null = null): DatasetFact =>
    ({ name, state: null, subjects: 1204, visits: 5310, scans: 20877, feeds }) as unknown as DatasetFact;
  const list = [fact("study-a", ["study-a"]), fact("study-b")];

  it("is the cohort when the words call it one", () => {
    const cohorts = ["study-a", "ms-cohort-b"];
    expect(cohortsMeant("In the study-a cohort, how many subjects have a FLAIR?", list, cohorts)).toEqual([
      "study-a",
    ]);
    expect(cohortsMeant("How many scans do the members of the cohort study-a have?", list, cohorts)).toEqual([
      "study-a",
    ]);
    // called a dataset, called both, or called neither: the dataset stays named
    for (const words of [
      "How many T2w scans are stored in the dataset study-a?",
      "In the study-a cohort, how many scans come from the study-a dataset?",
      "How many scans does study-a hold?",
    ])
      expect(cohortsMeant(words, list, cohorts), words).toEqual([]);
    // a dataset that is no cohort's name is a dataset whatever the words say beside it
    expect(cohortsMeant("In the study-b cohort, how many?", list, cohorts)).toEqual([]);
  });

  it("is said in the hint, with no dataset clause", () => {
    expect(cohortNote([])).toBe("");
    expect(cohortNote(["study-a"])).toMatch(
      /name the cohort study-a; a dataset has the same name.*cohort's members alone, with no dataset clause/u,
    );
  });
});

describe("a scanner's station", () => {
  it("is the field's word, and a station of the chat's own is not", () => {
    for (const plain of [
      "Counted as the same scanner model and station name on both visits.",
      "The station names differ between the two.",
      "Kept only where both were done on the same station: 632 sessions.",
      "They agree on scanner model, station and both protocols.",
      "The other 282 had their pair on different machines or stations.",
      "A station alone is a room's label, which several scanner models share.",
      "Each visit's scanner was read from its largest scan of the kind, among the 632 visits that hold one, and a subject counted with two visits on one model and station pair.",
    ])
      expect(unplainWords(plain), plain).toEqual([]);
    expect(unplainWords("Another station counted them.")).toEqual(
      expect.arrayContaining(["another station", "station"]),
    );
    expect(unplainWords("The ask-help station counted 24 subjects.")).toEqual(["station"]);
  });
});
