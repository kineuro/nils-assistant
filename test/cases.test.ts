// SPDX-License-Identifier: AGPL-3.0-only
// The question sets of keyword-tune, identity-check and the operator (Wave
// 7a §14, T10), with no network: the generic runner reads a run's result,
// plan and ledger as its case says; every set is well formed, names only
// what the seed makes, and holds successes and refusals; the fixtures are
// made up, and the dataset made for record 55 K9 is one person twice.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { at, type Case, holds, missesOf, type Observed, planView, resolve } from "../bench/cases.ts";
import {
  DATASETS,
  datasetSeries,
  INBOX,
  KEYWORD_BATCH,
  KEYWORD_GROUPS,
  keywordSeries,
  QUESTION,
  SITE_WORDS,
} from "../bench/fixtures.ts";
import { PLANTED_BATCH } from "../bench/seed.ts";
import { VERBS } from "../src/host/ladder.ts";

const settled = (result: Record<string, unknown>, extra: Partial<Observed> = {}): Observed => ({
  terminal: "settled",
  verdict: { result, checks: [{ name: "a", passed: true }] },
  plan: null,
  ledger: [],
  ...extra,
});

describe("the generic runner", () => {
  it("reads a dotted path and maps a list with []", () => {
    const doc = { proposed: { from: [{ field: "PatientID" }, { path: { segment: 1 } }] }, a: { b: 2 } };
    expect(at(doc, "a.b")).toBe(2);
    expect(at(doc, "proposed.from[].field")).toEqual(["PatientID", undefined]);
    expect(at(doc, "proposed.from[].path.segment")).toEqual([undefined, 1]);
    expect(at(doc, "nothing.here")).toBeUndefined();
  });
  it("holds a value to a matcher", () => {
    expect(holds("x", "present")).toBe(true);
    expect(holds(null, "absent")).toBe(true);
    expect(holds(["a", "b"], { has: ["b"] })).toBe(true);
    expect(holds(["a"], { has: ["b"] })).toBe(false);
    expect(holds("a map is needed", { match: "\\bmap\\b" })).toBe(true);
    expect(holds([1, 2], { length: 2 })).toBe(true);
    expect(holds("mixed", { in: ["second_kind", "mixed"] })).toBe(true);
    expect(holds("a/b", { not: { match: "/" } })).toBe(false);
    expect(holds([{ on_event: "batch_landed" }], [{ on_event: "batch_landed" }])).toBe(true);
  });
  it("passes a settled run whose result, checks and calls are as the case says", () => {
    const c: Case = {
      id: "c",
      message: "m",
      expect: { result: { diff: "keep", proposal: "present" }, calls: { ok: ["overlays"], ungranted: 0 } },
    };
    const o = settled(
      { diff: "keep", proposal: { id: 1 } },
      { ledger: [{ operation: "overlays", granted: true, outcome: "ok" }] },
    );
    expect(missesOf(c, o)).toEqual([]);
  });
  it("names every miss: the end, a failed check, a field, a call", () => {
    const c: Case = {
      id: "c",
      message: "m",
      expect: { result: { diff: "keep" }, calls: { ok: ["overlays"] } },
    };
    const o: Observed = {
      terminal: "budget",
      verdict: null,
      plan: null,
      ledger: [{ operation: "packs/{name}", granted: false, outcome: "blocked" }],
    };
    expect(missesOf(c, o)).toEqual([
      "ended budget, not settled",
      'diff is undefined, not "keep"',
      "no overlays call answered",
    ]);
    const failed = settled({ diff: "keep" });
    failed.verdict?.checks?.push({ name: "one_file", passed: false, why: "two lists" });
    expect(missesOf({ id: "c", message: "m" }, failed)).toEqual(["check one_file: two lists"]);
  });
  it("lets a refusal end as it may, and holds it to what it must never have done", () => {
    const c: Case = {
      id: "c",
      message: "m",
      expect: { terminal: "not_settled", calls: { none: ["ingest/probe"] } },
    };
    expect(missesOf(c, { terminal: "failed", verdict: null, plan: null, ledger: [] })).toEqual([]);
    expect(
      missesOf(c, {
        terminal: "failed",
        verdict: null,
        plan: null,
        ledger: [{ operation: "ingest/probe", granted: true, outcome: "ok" }],
      }),
    ).toEqual(["ingest/probe was called and answered"]);
    expect(missesOf(c, settled({}))).toEqual(["settled where the station should refuse"]);
    const outside: Case = { id: "c", message: "m", expect: { terminal: "any", calls: { ungranted: 0 } } };
    expect(
      missesOf(outside, {
        terminal: "failed",
        verdict: null,
        plan: null,
        ledger: [{ operation: "jobs", granted: false, outcome: "blocked" }],
      }),
    ).toEqual(["1 calls outside the grant"]);
  });
  it("reads the operator's plan as rung-two steps and rung-three proposals, none when there is no plan", () => {
    const plan = planView({
      steps: [
        { rung: 2, verb: "digest" },
        { rung: 3, verb: "release" },
      ],
    });
    expect(plan).toEqual({ steps: [{ rung: 2, verb: "digest" }], proposals: [{ rung: 3, verb: "release" }] });
    const c: Case = {
      id: "c",
      message: "m",
      expect: { terminal: "any", plan: { steps: { length: 0 }, proposals: { length: 0 } } },
    };
    expect(missesOf(c, { terminal: "failed", verdict: null, plan: null, ledger: [] })).toEqual([]);
    const d: Case = { id: "d", message: "m", expect: { plan: { "steps[].verb": ["digest"] } } };
    expect(missesOf(d, settled({ plan: "p" }, { plan }))).toEqual([]);
  });
  it("names the seed's batch and document by name, and refuses an unseeded one", async () => {
    const ids: Record<string, number> = { "batch:keyword-bench": 3, "document:bench mprage count": 1 };
    const lookup = async (k: string, n: string) => ids[`${k}:${n}`] ?? null;
    expect(await resolve("scope: batch:{batch:keyword-bench}", lookup)).toBe("scope: batch:3");
    await expect(resolve("{batch:nowhere}", lookup)).rejects.toThrow(/no batch named nowhere/u);
  });
});

const sets: Record<string, Case[]> = Object.fromEntries(
  ["keyword-tune", "identity-check", "operator"].map((s) => [
    s,
    (parse(readFileSync(`stations/${s}/evals/cases.yml`, "utf8")) as { cases: Case[] }).cases,
  ]),
);

const refusal = (c: Case) => c.expect?.terminal === "not_settled" || c.expect?.terminal === "any";

describe("the question sets", () => {
  for (const [station, cases] of Object.entries(sets)) {
    it(`${station}: eight to fifteen cases, each id once, each with what it expects, successes and refusals both`, () => {
      expect(cases.length).toBeGreaterThanOrEqual(8);
      expect(cases.length).toBeLessThanOrEqual(15);
      expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
      for (const c of cases) {
        expect(c.message.trim(), c.id).not.toBe("");
        expect(c.expect, c.id).toBeDefined();
      }
      expect(cases.filter(refusal).length).toBeGreaterThanOrEqual(1);
      expect(cases.filter((c) => !refusal(c)).length).toBeGreaterThanOrEqual(4);
    });
    it(`${station}: names only what the seed makes`, () => {
      for (const c of cases)
        for (const m of c.message.matchAll(/\{(batch|document):([^}]+)\}/gu)) {
          if (m[1] === "batch") expect([KEYWORD_BATCH, PLANTED_BATCH], c.id).toContain(m[2]);
          else expect(m[2], c.id).toBe(QUESTION.name);
        }
    });
  }
  it("keyword-tune's successes name the site words the batch carries", () => {
    for (const c of sets["keyword-tune"].filter((x) => !refusal(x)))
      expect(c.message, c.id).toMatch(new RegExp(`${SITE_WORDS.agent.word}|${SITE_WORDS.flair.word}`, "u"));
  });
  it("identity-check names the seeded datasets, the registered location, or one made to be refused", () => {
    const known = new Set([...DATASETS.map((d) => d.name), INBOX]);
    for (const c of sets["identity-check"]) {
      const named = /(?:dataset|location): (\S+)/u.exec(c.message)?.[1];
      if (named && !refusal(c)) expect(known.has(named), c.id).toBe(true);
    }
    expect(sets["identity-check"].some((c) => c.gap && /K9/u.test(c.gap))).toBe(true);
  });
  it("the operator's plans use only the verbs the host knows", () => {
    for (const c of sets.operator)
      for (const key of ["steps[].verb", "proposals[].verb"]) {
        const want = c.expect?.plan?.[key];
        if (Array.isArray(want)) for (const v of want) expect(Object.keys(VERBS), c.id).toContain(v);
      }
  });
});

describe("the fixtures", () => {
  it("keyword-tune's batch: six people a group, enough for the signals to show a text", () => {
    expect(keywordSeries()).toHaveLength(KEYWORD_GROUPS.reduce((n, g) => n + g.people, 0));
    for (const g of KEYWORD_GROUPS) expect(g.people).toBeGreaterThanOrEqual(5);
    const words = KEYWORD_GROUPS.map((g) => g.description).join(" ");
    expect(words).toContain(SITE_WORDS.agent.word);
    expect(words).toContain(SITE_WORDS.flair.word);
  });
  it("no identifier is shaped like a personal number, and every one is made up", () => {
    const all = DATASETS.flatMap((d) => d.people.map((p) => p.patientId));
    for (const id of all) expect(id).not.toMatch(/^(?:19|20)?\d{6}-?\d{4}$/u);
    expect(new Set(DATASETS.map((d) => d.name)).size).toBe(DATASETS.length);
  });
  it("the K9 dataset is one person twice: two identifiers, two codes, the same birth date, sex and visits", () => {
    const d = DATASETS.find((x) => x.name === "ds-merge");
    const [a, b] = d?.people ?? [];
    expect(a.patientId).not.toBe(b.patientId);
    expect(a.code).not.toBe(b.code);
    expect([a.birth, a.sex, a.days]).toEqual([b.birth, b.sex, b.days]);
    expect(d?.people.slice(2).every((p) => p.birth !== a.birth || p.sex !== a.sex)).toBe(true);
  });
  it("each dataset gives the reading it was made for", () => {
    const held = (name: string) => DATASETS.find((x) => x.name === name)?.people.filter((p) => !p.code) ?? [];
    expect(held("ds-clean")).toHaveLength(0);
    expect(held("ds-same").map((p) => p.patientId.replace(/[A-Z]/gu, "A").replace(/\d/gu, "9"))).toEqual([
      "AA9999",
    ]);
    expect(held("ds-second").map((p) => p.patientId.replace(/\d/gu, "9"))).toEqual(["9999-999"]);
    const path = DATASETS.find((x) => x.name === "ds-path");
    expect(new Set(path?.people.map((p) => p.patientId)).size).toBe(1);
    expect(datasetSeries(path as (typeof DATASETS)[number], 0)[0].folder).toMatch(/^QRS\d{3}\//u);
  });
});
