// SPDX-License-Identifier: AGPL-3.0-only
// One chat (2026-10-09), the datasets in the turn's facts. Asked how many T1
// scans with contrast a dataset held, the chat said there was no such
// dataset: its facts listed the cohorts and nothing of the datasets. Each
// dataset now comes with its state, its subjects, visits and scans and the
// cohort it feeds, the newest thirty listed and the rest counted; words that
// name one get its line in the hint, and a follow-up keeps it; the
// registry's search finds it; a question names it with the ask's `dataset`
// field; and an answer that says a named dataset is not there goes back once.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SETS } from "../src/host/grants.ts";
import { complaintsOf } from "../src/one/checks.ts";
import {
  carriedHint,
  citesCount,
  type DatasetFact,
  datasetHint,
  datasetsBlock,
  datasetsNamed,
  datasetsOf,
  forgetDatasets,
  knownDatasets,
  leavesDatasets,
  lineOf,
  namesOnly,
  readDatasets,
  saysNotThere,
} from "../src/one/datasets.ts";
import { factsOf } from "../src/one/facts.ts";
import { grantsLine, mountFor } from "../src/one/mount.ts";
import { hintLine, routeOf } from "../src/one/route.ts";
import { loadSkills } from "../src/one/skills.ts";
import { conversationOf, newTurn } from "../src/one/state.ts";
import { searchCatalog } from "../src/one/tools.ts";
import { Seam, type Station } from "../src/seam/client.ts";
import { Ledger } from "../src/seam/ledger.ts";

/** The sources door of Wave 7a: each source place with its dataset, its last digest and its totals. */
const SOURCES = {
  count: 3,
  window_days: 31,
  sources: [
    {
      id: 1,
      name: "ms-a",
      role: "source",
      created_at: "2026-09-01 10:00:00",
      updated_at: "2026-09-01 10:00:00",
      dataset: { kind: "dataset", arrives: "identified", state: "both", cohort: "ms-cohort-a" },
      cohort: "ms-cohort-a",
      digests: { count: 2, last: { name: "second", finished_at: "2026-09-02 10:00:00" } },
      totals: { subjects: 24, studies: 90, sessions: 80, stacks: 900, to_sort: 1, sure: 899, unsorted: 0 },
    },
    {
      id: 2,
      name: "study-big",
      role: "source",
      created_at: "2026-10-09 08:00:00",
      updated_at: "2026-10-09 08:00:00",
      dataset: { kind: "dataset", arrives: "identified", state: "identified", cohort: null },
      cohort: null,
      digests: { count: 1, last: { name: "today", finished_at: "2026-10-09 09:00:00" } },
      totals: {
        subjects: 120,
        studies: 400,
        sessions: 340,
        stacks: 5210,
        refused_files: 0,
        to_sort: 310,
        sure: 4900,
        unsorted: 0,
        need_a_look: { axis_conflict: 300, "body_part:low_confidence": 20 },
      },
    },
    {
      id: 3,
      name: "archive",
      role: "source",
      created_at: "2026-10-09 09:30:00",
      dataset: { kind: "root", arrives: "undeclared", state: "unknown" },
      totals: { subjects: 144, sessions: 420, stacks: 6110 },
    },
  ],
};

/** The cohorts door: the datasets each feeds, a retired cohort among them. */
const COHORTS = [
  { name: "ms-cohort-a", subjects: 24, feeds: ["ms-a"] },
  { name: "both-sites", subjects: 140, feeds: ["ms-a", "study-big"] },
  { name: "old-study", subjects: 3, feeds: ["study-big"], retired_at: "2026-01-01" },
];

const fact = (name: string, at: number, scans = 10): DatasetFact => ({
  name,
  state: "identified",
  subjects: 2,
  visits: 3,
  scans,
  sure: scans,
  look: 0,
  unsorted: 0,
  feeds: [],
  at,
});

describe("the datasets the facts carry", () => {
  it("reads each dataset's state, counts and the cohorts it feeds, and leaves a root of datasets out", () => {
    const list = datasetsOf(SOURCES, COHORTS);
    expect(list.map((d) => d.name)).toEqual(["ms-a", "study-big"]);
    const big = list.find((d) => d.name === "study-big");
    expect(big).toMatchObject({
      state: "identified",
      subjects: 120,
      visits: 340,
      scans: 5210,
      sure: 4900,
      look: 310,
      feeds: ["both-sites"],
    });
    expect(list.find((d) => d.name === "ms-a")?.feeds).toEqual(["both-sites", "ms-cohort-a"]);
  });

  it("writes them newest first in the registry's words, with nothing a tag would escape", () => {
    const block = datasetsBlock({ kind: "ok", list: datasetsOf(SOURCES, COHORTS) });
    expect(block).toMatch(/^## The datasets \(where the scans came from\)/u);
    expect(block).toMatch(
      /in all is its count here; anything narrower is a question that names the dataset/u,
    );
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toEqual([
      "- study-big (identified): 120 subjects, 340 visits, 5210 scans (4900 sure, 310 need a look); feeds the cohort both-sites",
      "- ms-a (both): 24 subjects, 80 visits, 900 scans (899 sure, 1 needs a look); feeds the cohorts both-sites and ms-cohort-a",
    ]);
    expect(block).not.toMatch(/[<>&]/u);
    expect(block).not.toMatch(/\bpeople\b/iu);
  });

  it("lists the newest thirty and counts the rest", () => {
    const list = Array.from({ length: 35 }, (_, i) => fact(`ds-${i}`, Date.UTC(2026, 0, 1 + i)));
    const block = datasetsBlock({ kind: "ok", list });
    const lines = block.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(31);
    expect(lines[0]).toMatch(/^- ds-34 /u);
    expect(lines[29]).toMatch(/^- ds-5 /u);
    expect(lines[30]).toMatch(/^- and 5 older datasets not listed here/u);
  });

  it("reads an engine from before Wave 7a: the state from how the data arrives, and no sure count", () => {
    const list = datasetsOf({
      sources: [
        {
          name: "ds-old",
          arrives: "deidentified",
          dataset: { arrives: "deidentified", cohort: null },
          totals: { subjects: 3, studies: 4, sessions: 4, stacks: 10, to_sort: 2 },
        },
        {
          name: "ds-new",
          arrives: "identified",
          totals: { subjects: 0, sessions: 0, stacks: 0, to_sort: 0 },
        },
      ],
    });
    const lines = datasetsBlock({ kind: "ok", list })
      .split("\n")
      .filter((l) => l.startsWith("- "));
    expect(lines).toContain(
      "- ds-old (anonymised): 3 subjects, 4 visits, 10 scans (2 need a look); feeds no cohort",
    );
    expect(lines).toContain("- ds-new (identified): no scans yet; feeds no cohort");
  });

  it("says when the datasets are not open to the person, or could not be read, and never that one is not there", () => {
    expect(datasetsBlock({ kind: "closed" })).toMatch(/not open to this person[\s\S]*an admin can give it/u);
    expect(datasetsBlock({ kind: "unread" })).toMatch(/could not be read this turn/u);
    for (const b of [datasetsBlock({ kind: "closed" }), datasetsBlock({ kind: "unread" })])
      expect(b).toMatch(/Never say a dataset is not there/u);
    expect(datasetsBlock({ kind: "ok", list: [] })).toMatch(/holds no dataset yet/u);
  });

  it("names the datasets the ask's catalog lists when their counts are not open, since a question can name one", () => {
    const names = namesOnly(["study-big", "ms-a", "", 3]);
    expect(names.map(lineOf)).toEqual([
      "study-big: its counts are not at hand",
      "ms-a: its counts are not at hand",
    ]);
    const closed = datasetsBlock({ kind: "closed" }, names);
    expect(closed).toMatch(/Their counts are not open to this person, but a question can name one/u);
    expect(closed).toMatch(/By name: study-big, ms-a\./u);
    expect(closed).not.toMatch(/admin/u);
    expect(datasetsBlock({ kind: "unread" }, names)).toMatch(
      /could not be read this turn, but a question can name one/u,
    );
    expect(datasetsNamed("How many T1 scans are in study-big?", names).map((d) => d.name)).toEqual([
      "study-big",
    ]);
  });

  it("sends the datasets once, and again when they change", () => {
    const first = factsOf({
      told: { summary: null, grants: null },
      summary: "S",
      datasets: "D",
      grants: "G",
      hint: "H",
      document: null,
    });
    expect(first.text).toBe("S\n\nD\n\nG\n\nH");
    const same = factsOf({
      told: first.told,
      summary: "S",
      datasets: "D",
      grants: "G",
      hint: "H2",
      document: null,
    });
    expect(same.text).toBe("H2");
    const grown = factsOf({
      told: same.told,
      summary: "S",
      datasets: "D2",
      grants: "G",
      hint: "H3",
      document: null,
    });
    expect(grown.text).toBe("D2\n\nH3");
  });
});

describe("words that name a dataset", () => {
  const list = datasetsOf(SOURCES, COHORTS);

  it("are matched by the dataset's whole name", () => {
    const named = (m: string) => datasetsNamed(m, [...list, fact("study", 0)]).map((d) => d.name);
    expect(named("How many T1 scans with contrast are in study-big?")).toEqual(["study-big"]);
    expect(named("How many scans does @Study-Big hold")).toEqual(["study-big"]);
    expect(named("Which studies have an MPRAGE?")).toEqual([]);
    expect(named("compare study and ms-a")).toEqual(["ms-a", "study"]);
  });

  it("get the dataset's line in the hint: its count in all from the facts, anything narrower a question", () => {
    const [big] = datasetsNamed("How many scans are in study-big?", list);
    const hint = datasetHint([big], "Anything narrower is a question that names the dataset.");
    expect(hint).toMatch(
      /they name the dataset study-big \(identified\): 120 subjects, 340 visits, 5210 scans/u,
    );
    expect(hint).toMatch(
      /in all is that count: answer with it, with no question drafted, and never say it is not there/u,
    );
    expect(hint).toMatch(/Anything narrower is a question that names the dataset\.$/u);
    expect(hint).not.toMatch(/[<>&]/u);
  });

  it("are kept by a follow-up that names none, until the words turn to a cohort", () => {
    const [big] = datasetsNamed("How many scans are in study-big?", list);
    const hint = carriedHint(
      [big],
      "activate the find-data skill and draft the question with the dataset named.",
    );
    expect(hint).toMatch(
      /earlier in this conversation the person named the dataset study-big \(identified\)/u,
    );
    expect(hint).toMatch(
      /keep it: activate the find-data skill and draft the question with the dataset named\./u,
    );
    expect(hint).not.toMatch(/[<>&]/u);
    const cohorts = ["ms-cohort-a", "nmosd"];
    expect(leavesDatasets("How many of them are 3D?", cohorts)).toBe(false);
    expect(leavesDatasets("Only those from 2020.", cohorts)).toBe(false);
    expect(leavesDatasets("How many subjects are in cohort B?", cohorts)).toBe(true);
    expect(leavesDatasets("And in nmosd?", cohorts)).toBe(true);
  });

  it("tell a count in all, which needs no question, from any other number", () => {
    const [big] = datasetsNamed("study-big", list);
    expect(citesCount("study-big holds 5,210 scans from 120 subjects.", [big])).toBe(true);
    expect(citesCount("study-big holds 5210 scans.", [big])).toBe(true);
    expect(citesCount("There are 37 T1 scans with contrast in study-big.", [big])).toBe(false);
    expect(citesCount("study-big holds 5210 scans.", [])).toBe(false);
    expect(citesCount("It holds 0 scans.", [{ ...big, subjects: 0, visits: 0, scans: 0 }])).toBe(false);
  });

  it("route a question of which datasets there are to the facts, and a count in a dataset to finding data", () => {
    expect(routeOf("Which datasets are there?")).toMatchObject({ skill: null, summary: true });
    expect(routeOf("How many datasets does the registry hold?")).toMatchObject({ summary: true });
    expect(hintLine(routeOf("Which datasets are there?"), ["find-data"])).toMatch(
      /the datasets\) answer this/u,
    );
    // a dataset named in a count is not a question of identities
    expect(routeOf("How many scans are in dataset ds-clean?").skill).toBe("find-data");
  });

  it("are found by the registry's search, even before its summary is read", () => {
    expect(searchCatalog(null, "study-big", list)).toEqual([
      "dataset study-big (identified): 120 subjects, 340 visits, 5210 scans (4900 sure, 310 need a look); feeds the cohort both-sites",
    ]);
    expect(
      searchCatalog({ cohorts: [{ name: "ms-cohort-a", members: 24 }] }, "ms-a ms-cohort-a", list),
    ).toEqual([
      "cohort ms-cohort-a (24 members)",
      "dataset ms-a (both): 24 subjects, 80 visits, 900 scans (899 sure, 1 needs a look); feeds the cohorts both-sites and ms-cohort-a",
    ]);
    // a name the ask's catalog lists whose counts the facts do not hold
    expect(searchCatalog({ datasets: ["study-big", "ds-new"] }, "ds-new study-big", list)).toEqual([
      "dataset study-big (identified): 120 subjects, 340 visits, 5210 scans (4900 sure, 310 need a look); feeds the cohort both-sites",
      "dataset ds-new",
    ]);
  });
});

describe("the words the agent reads about datasets", () => {
  it("teach a question that names a dataset with the ask's dataset field", () => {
    const find = loadSkills(["./stations"], ["find-data"]).get("find-data");
    if (!find) throw new Error("no find-data");
    const para = find.body.split("\n\n").find((x) => x.startsWith("A **dataset**")) ?? "";
    expect(para).toMatch(/\["=", \{\}, \["field", \{\}, "dataset"\], "study-big"\]/u);
    expect(para).toMatch(/\["=", \{\}, \["axis", \{\}, "post_contrast"\], "given"\]/u);
    expect(para).toMatch(/`=`, `in` and `has` ask whether one is among them/u);
    expect(para).toMatch(/A follow-up that names no other dataset .* keeps the clause/u);
    expect(para).not.toMatch(/cannot narrow|over that cohort/u);
  });

  it("say subjects, never people", () => {
    expect(grantsLine(mountFor(SETS.admin))).toMatch(/check how a dataset tells its subjects apart/u);
    const skills = loadSkills(["./stations"], ["find-data", "check-identities"]);
    for (const [id, sk] of skills) {
      expect(sk.description, id).not.toMatch(/\bpeople\b/iu);
      expect(sk.body, id).not.toMatch(/\bpeople\b/iu);
    }
    expect(grantsLine(mountFor(SETS.admin))).not.toMatch(/\bpeople\b/iu);
  });
});

describe("an answer about a named dataset", () => {
  it("is sent back once when it says the dataset is not there", async () => {
    const said = [
      "There's no cohort or dataset called study-big in the registry; the only thing by that name is a batch of today's import.",
      "There is no dataset named study-big.",
      "I couldn't find a dataset called study-big.",
      "study-big isn’t a dataset.",
      "study-big does not exist in the registry.",
    ];
    for (const answer of said) {
      expect(saysNotThere(answer, ["study-big"]), answer).toBe(true);
      const t = newTurn("ds-check", "How many T1 scans with contrast are in study-big?");
      t.datasets = ["study-big"];
      t.texts.push(answer);
      const out = await complaintsOf({
        turn: t,
        convo: conversationOf("ds-check"),
        conversation: "ds-check",
        validate: null,
        hinted: null,
      });
      expect(out.join(" "), answer).toMatch(/name the dataset study-big, which the registry holds/u);
    }
  });

  it("settles when it answers from the dataset's counts, or from a question that names it", async () => {
    const fine = [
      "study-big holds 5210 scans from 120 subjects over 340 visits; 4900 are sure and 310 need a look.",
      "study-big has no T1 scans with contrast; it holds 5210 scans in all.",
      "There is no dataset filter in a question yet; study-big holds 5210 scans.",
      "study-big is a dataset, not a cohort: it holds 5210 scans.",
    ];
    for (const answer of fine) {
      expect(saysNotThere(answer, ["study-big"]), answer).toBe(false);
      const t = newTurn("ds-fine", "How many scans are in study-big?");
      t.datasets = ["study-big"];
      t.texts.push(answer);
      // the words look like finding data, but a named dataset is answered from its counts: no hint to draft
      const out = await complaintsOf({
        turn: t,
        convo: conversationOf("ds-fine"),
        conversation: "ds-fine",
        validate: null,
        hinted: null,
      });
      expect(out, answer).toEqual([]);
    }
  });

  it("is held only when the words named a dataset the facts list", async () => {
    const t = newTurn("ds-none", "How many subjects are in the ALS cohort?");
    t.texts.push("There is no ALS cohort, and no dataset called ALS either.");
    const out = await complaintsOf({
      turn: t,
      convo: conversationOf("ds-none"),
      conversation: "ds-none",
      validate: null,
      hinted: null,
    });
    expect(out).toEqual([]);
  });
});

describe("reading the datasets", () => {
  const dir = mkdtempSync(join(tmpdir(), "one-datasets-"));
  const station: Station = {
    id: "nils.identity-check",
    version: "t",
    grant: { sources: { calls: 12 }, cohorts: { calls: 12 } },
    ceiling: "operator",
    content: "rows",
    model: "none",
  };
  /** A seam over a fetch the test answers, after `ms`. */
  function seamOver(answer: (path: string) => { status: number; body: unknown }, ms = 0) {
    const calls: string[] = [];
    const seam = new Seam({
      engine: "http://engine.test",
      station,
      conversation: "ds-read",
      token: () => null,
      authOff: () => true,
      ledger: new Ledger(join(dir, `seam-${Math.random().toString(36).slice(2)}.sqlite`)),
      fetch: (async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        calls.push(`${new URL(String(url)).pathname}${new URL(String(url)).search}`);
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const a = answer(path);
        return new Response(JSON.stringify(a.body), {
          status: a.status,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    return { seam, calls };
  }
  const engine = (path: string) =>
    path === "/api/sources"
      ? { status: 200, body: SOURCES }
      : path === "/api/cohorts"
        ? { status: 200, body: COHORTS }
        : { status: 404, body: {} };

  beforeEach(() => forgetDatasets());

  it("reads the sources and the cohorts under the person's seams, and keeps them for the turn's tools", async () => {
    const { seam, calls } = seamOver(engine);
    const r = await readDatasets({
      key: "p1",
      sources: () => seam,
      cohorts: () => seam,
      toolCallId: "t",
      phase: "turn",
    });
    expect(r.kind).toBe("ok");
    expect(calls.sort()).toEqual(["/api/cohorts", "/api/sources?recent=1"]);
    expect(knownDatasets("p1")?.map((d) => d.name)).toEqual(["ms-a", "study-big"]);
    expect(knownDatasets("p2")).toBeNull();
  });

  it("reads a refusal as closed to the person, remembered as none", async () => {
    const { seam } = seamOver(() => ({ status: 403, body: { error: "data:see" } }));
    const r = await readDatasets({ key: "p3", sources: () => seam, toolCallId: "t", phase: "turn" });
    expect(r).toEqual({ kind: "closed" });
    expect(knownDatasets("p3")).toEqual([]);
  });

  it("goes on with the last read when the door is slow, and joins a read under way", async () => {
    const { seam, calls } = seamOver(engine, 150);
    const first = await readDatasets({
      key: "p4",
      sources: () => seam,
      toolCallId: "t",
      phase: "turn",
      wait: 10,
    });
    expect(first).toEqual({ kind: "unread" });
    // the slow read goes on and is joined, not dialled again
    const joined = await readDatasets({
      key: "p4",
      sources: () => seam,
      toolCallId: "t",
      phase: "turn",
      wait: 1000,
    });
    expect(joined.kind).toBe("ok");
    expect(calls).toEqual(["/api/sources?recent=1"]);
    // slow again: the turn takes what was read last
    const again = await readDatasets({
      key: "p4",
      sources: () => seam,
      toolCallId: "t",
      phase: "turn",
      wait: 10,
    });
    expect(again.kind === "ok" && again.list.map((d) => d.name)).toEqual(["ms-a", "study-big"]);
    // the read under way finishes before the next test
    await readDatasets({ key: "p4", sources: () => seam, toolCallId: "t", phase: "turn", wait: 1000 });
  });
});
