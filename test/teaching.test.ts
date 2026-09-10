// SPDX-License-Identifier: AGPL-3.0-only
// Teaching (Wave 5 D3, bar 7): the loop once on the bench against stubs.
// Corrections listed and curated into a set; a dry fine-tune job that
// registers a candidate in a stub Kvasir; admission passes and the bench
// fails, promote refused with the sentence; the bench passes while the
// admission has not, refused; both green, promoted with the proposal.

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Lineage } from "../src/host/lineage.ts";
import {
  type Candidate,
  corrections,
  gates,
  type KvasirLifecycle,
  parseRecipe,
  type ReviewItem,
  recordedBench,
  scriptRunner,
  Teaching,
  TeachingStore,
} from "../src/host/teaching.ts";

/** A stub of Kvasir's lifecycle: registered, admitted by a switch, promoted with the proposal recorded. */
function stubKvasir(admitPasses: () => boolean) {
  const candidates: Candidate[] = [];
  const promotions: { id: number; proposal: unknown }[] = [];
  let next = 1;
  const kv: KvasirLifecycle = {
    async list() {
      return {
        candidates,
        promoted: [
          { backend: "card0", model: candidates.find((c) => c.state === "promoted")?.model ?? null },
        ],
      };
    },
    async register(body) {
      const c: Candidate = {
        id: next++,
        ...body,
        state: "registered",
        admission: null,
        proposal: null,
        notes: body.notes ?? null,
      };
      candidates.push(c);
      return c;
    },
    async admit(id) {
      const c = candidates.find((x) => x.id === id) as Candidate;
      const passed = admitPasses();
      c.admission = {
        suite: "kvasir admission",
        version: "t",
        passed,
        failed: passed ? [] : ["schema"],
        record: 1,
        at: Date.now(),
      };
      if (passed) c.state = "admitted";
      return { candidate: c };
    },
    async promote(id, proposal) {
      const c = candidates.find((x) => x.id === id) as Candidate;
      if (!c.admission?.passed) throw new Error("kvasir would refuse: no passed admission");
      c.state = "promoted";
      c.proposal = proposal;
      promotions.push({ id, proposal });
      return { candidate: c };
    },
    async retire(id) {
      const c = candidates.find((x) => x.id === id) as Candidate;
      c.state = "retired";
      return { candidate: c };
    },
  };
  return { kv, candidates, promotions };
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), "teaching-"));
  const lineage = new Lineage(join(dir, "lineage.sqlite"));
  const store = new TeachingStore(join(dir, "teaching.sqlite"), join(dir, "teaching"));
  return { dir, lineage, store };
}

const REVIEW: ReviewItem[] = [
  {
    id: 7,
    kind: "technique:low_confidence",
    scope: "stack",
    status: "decided",
    decided_at: "2026-09-10T08:00:00Z",
    evidence: { candidates: [{ value: "MPRAGE" }, { value: "SPACE" }] },
    decision: {
      axis: "technique",
      value: "SPACE",
      actor: "anna",
      author_kind: "person",
      why: "the vendor name says so",
    },
  },
  {
    id: 8,
    kind: "base:vote",
    scope: "stack",
    status: "decided",
    decided_at: "2026-09-10T08:10:00Z",
    evidence: { candidates: [{ value: "T1w" }] },
    decision: { axis: "base", value: "T2w", actor: "anna", author_kind: "person", why: null },
  },
  {
    id: 9,
    kind: "base:missing",
    scope: "stack",
    status: "decided",
    decided_at: "2026-09-10T08:20:00Z",
    evidence: { candidates: [{ value: "T1w" }] },
    decision: { axis: "base", value: "T1w", actor: "model", author_kind: "model" },
  },
  { id: 10, kind: "base:missing", scope: "stack", status: "open" },
];

describe("teaching, the loop once on the bench", () => {
  it("lists the corrections the group gave, without a row, and curates them into a set the bench reads", () => {
    const h = harness();
    h.lineage.open({ id: "c1", station: "ask-help", subject: "anna", lineage: 3, document: 3 });
    h.lineage.proposed({ conversation: "c1", document: 4, parent: 3, sentence: "narrow to cohort a" });
    h.lineage.decide("c1", "rejected", { document: 4, why: "cohort b was meant" });
    const list = corrections(h.lineage, REVIEW, new Set([8]));
    expect(list.map((c) => [c.id, c.kind])).toEqual([
      ["proposal:1", "rejected_proposal"],
      ["review:7:pack", "overturned_pack"],
      ["review:8:station", "overturned_station"],
    ]);
    expect(list[0].why).toBe("cohort b was meant");
    expect(list[1].correction).toMatch(/where the pack chose MPRAGE/);
    for (const c of list) expect(JSON.stringify(c)).not.toMatch(/subject\.code|S-\d{4}/);
    const set = h.store.curate("september corrections", "anna", list);
    expect(set.count).toBe(3);
    expect(existsSync(set.path)).toBe(true);
    const lines = readFileSync(set.path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { trajectory: string });
    expect(lines.every((l) => l.trajectory === "correction")).toBe(true);
    expect(h.store.sets().map((s) => s.name)).toEqual(["september corrections"]);
  });

  it("reads a recipe and refuses one without a base", () => {
    expect(parseRecipe({ base: "qwen38-27b", steps: 5 })).toEqual({
      base: "qwen38-27b",
      method: "lora",
      steps: 5,
      rank: 8,
      lr: 0.0001,
    });
    expect(parseRecipe({})).toEqual({ refused: "a recipe names its base model" });
    expect(parseRecipe({ base: "x", method: "full" })).toHaveProperty("refused");
  });

  it("runs the fine-tune as a job, dry when torch is not here, and registers the candidate with its recipe", async () => {
    const h = harness();
    const set = h.store.curate("s", "anna", corrections(h.lineage, REVIEW, new Set()));
    const { kv, candidates } = stubKvasir(() => true);
    const runner = scriptRunner(new URL("../bench/finetune.py", import.meta.url).pathname);
    const t = new Teaching({
      store: h.store,
      runner,
      bench: async () => ({ passed: 0, of: 1, strict: 0, median_seconds: null, dry: true, note: null }),
      backend: "card0",
      threshold: (of) => of,
    });
    const { job, done } = t.fineTune(
      set,
      "anna",
      { base: "qwen38-27b", method: "lora", steps: 3, rank: 4, lr: 0.0001 },
      kv,
    );
    expect(job.state).toBe("running");
    const finished = await done;
    expect(finished.state).toBe("done");
    expect(finished.outcome?.dry).toBe(true);
    expect(finished.outcome?.set_digest).toBe(set.digest);
    expect(finished.candidate).toBe(1);
    expect(candidates[0].source).toMatchObject({
      kind: "fine-tune",
      job: job.id,
      recipe: { base: "qwen38-27b", steps: 3, set: set.id },
    });
    expect(h.store.jobs("anna")[0].candidate).toBe(1);
  });

  it("refuses promotion until both gates are green, then promotes with the proposal", async () => {
    const h = harness();
    let admits = true;
    let benchPasses = false;
    const { kv, candidates, promotions } = stubKvasir(() => admits);
    const t = new Teaching({
      store: h.store,
      runner: async (_s, recipe) => ({
        dry: true,
        base: recipe.base,
        steps: 0,
        adapter: null,
        set_digest: "d",
        note: "dry",
      }),
      bench: async () => ({
        passed: benchPasses ? 36 : 30,
        of: 36,
        strict: benchPasses ? 36 : 30,
        median_seconds: 15,
        dry: true,
        note: null,
      }),
      backend: "card0",
      threshold: (of) => of,
    });
    const set = h.store.curate("s", "anna", []);
    await t.fineTune(set, "anna", { base: "b", method: "lora", steps: 1, rank: 1, lr: 0.001 }, kv).done;
    const proposal = { id: "prop-1", principal: "anna" };
    // admission passes, the bench fails
    await kv.admit(1);
    await t.bench(candidates[0], "anna");
    let r = await t.promote(candidates[0], proposal, kv);
    expect(r).toMatchObject({ ok: false });
    expect((r as { refused: string }).refused).toMatch(/the bench stands at 30 of 36, under the 36 it needs/);
    // the bench passes while the admission has not
    admits = false;
    benchPasses = true;
    await t.fineTune(set, "anna", { base: "b", method: "lora", steps: 1, rank: 1, lr: 0.001 }, kv).done;
    await kv.admit(2);
    await t.bench(candidates[1], "anna");
    r = await t.promote(candidates[1], proposal, kv);
    expect((r as { refused: string }).refused).toMatch(/the admission suite has not passed \(schema\)/);
    // both green
    admits = true;
    await kv.admit(2);
    r = await t.promote(candidates[1], proposal, kv);
    expect(r).toMatchObject({ ok: true });
    expect(promotions).toEqual([{ id: 2, proposal }]);
    expect(candidates[1].state).toBe("promoted");
    const all = await t.candidates(kv);
    expect(all.candidates.map((c) => [c.id, c.gates.admission, c.gates.bench])).toEqual([
      [1, true, false],
      [2, true, true],
    ]);
    expect(all.promoted).toEqual([{ backend: "card0", model: "b" }]);
    expect(gates(candidates[0], null, (of) => of).refused).toMatch(/has not run/);
  });

  it("benches from the recording when the model is not served, and says it is dry", async () => {
    const bench = recordedBench("/gate", (p) =>
      p.endsWith("baseline-qwen38-27b-fast.json")
        ? JSON.stringify({
            results: [
              { passed: true, seconds: 10 },
              { passed: false, seconds: 30 },
            ],
          })
        : null,
    );
    const c = {
      id: 1,
      model: "qwen38-27b-fast+lora-set1-job1",
      backend: "card0",
      source: { kind: "manual" },
      state: "registered",
      admission: null,
      proposal: null,
      notes: null,
    } as Candidate;
    expect(await bench(c)).toMatchObject({ passed: 1, of: 2, dry: true, median_seconds: 30 });
    expect(await bench({ ...c, model: "other" })).toMatchObject({ passed: 0, of: 0, dry: true });
  });
});
