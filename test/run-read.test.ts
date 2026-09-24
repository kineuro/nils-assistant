// SPDX-License-Identifier: AGPL-3.0-only
// run-read (record 49 A6): the manifest and its grant, a run's checks read
// into failures by reason and breaches by check, and every case of the
// station's fixture set played through read_run against a stub engine: a
// run with planted failures gets a reading that names them and a campaign
// document over the units past a check, stored as a draft ask and never
// made; a clean run gets no campaign.

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { loadManifests } from "../src/stations/manifest.ts";
import { breachDocument, entriesOf, readingOf, reasonClass } from "../src/stations/pipelines.ts";
import { readingById, runReadChecks, runReadTools, withNote } from "../src/stations/run-read.ts";
import type { Verdict } from "../src/stations/verdict.ts";
import { type Dialled, seamOf, stubEngine, toolContext } from "./child/stub-engine.ts";

interface Case {
  id: string;
  run: Record<string, unknown> & { id: number; pipeline_id: number };
  items: Record<string, unknown>[];
  expect: {
    failed: number;
    reasons: Record<string, number>;
    breaches: Record<string, number>;
    doubtful: number;
    campaign: boolean;
    role: string;
  };
}

const catalog = JSON.parse(readFileSync("bench/analyses/catalog.json", "utf8")) as {
  pipelines: Record<string, unknown>[];
};
const fixture = JSON.parse(readFileSync("stations/run-read/evals/runs.json", "utf8")) as { cases: Case[] };
const manifest = loadManifests(["./stations"]).get("run-read");
if (!manifest) throw new Error("no run-read manifest");

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

async function engineFor(c: Case) {
  const e = await stubEngine((call: Dialled) => {
    const path = call.path.replace(/\?.*$/u, "");
    if (call.method === "GET" && path === `/api/pipeline-runs/${c.run.id}`) return { body: c.run };
    if (call.method === "GET" && path === "/api/pipeline-runs") return { body: { runs: [c.run] } };
    const p = /^\/api\/pipelines\/(\d+)$/u.exec(path);
    if (call.method === "GET" && p) {
      const entry = catalog.pipelines.find((x) => x.id === Number(p[1]));
      return entry ? { body: entry } : null;
    }
    if (call.method === "GET" && path === "/api/review")
      return { body: { count: c.items.length, items: c.items } };
    if (call.method === "POST" && path === "/api/ask/draft") return { body: { document: 600 + c.run.id } };
    return null;
  });
  closers.push(e.close);
  return e;
}

const tool = (name: string) => {
  const t = runReadTools().find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("run-read's manifest", () => {
  it("reads runs, their pipeline, their review items and drafts an ask; it holds no door that closes, makes or runs", () => {
    expect(manifest.purpose).toBe("assistant.run-read");
    expect(manifest.content).toBe("rows");
    expect(manifest.ceiling).toBe("reviewer");
    expect(Object.keys(manifest.grant).sort()).toEqual([
      "draft",
      "pipeline-runs",
      "pipeline-runs/{id}",
      "pipelines/{name}",
      "review",
    ]);
    for (const door of ["jobs", "campaigns", "review/{id}/apply", "review/{id}/accept", "selections/{name}"])
      expect(manifest.grant).not.toHaveProperty(door);
    expect(manifest.writes).toEqual(["document_version", "note"]);
    expect(manifest.checks).toEqual(["read", "names_the_checks", "proposes_only"]);
  });
});

describe("a run's checks, read", () => {
  it("puts a failure in a few reason classes", () => {
    expect(reasonClass("failed", "sub-x/ses-1 holds no FLAIR")).toBe("a missing input");
    expect(reasonClass("failed", "the container exited with code 137")).toBe("the tool failed");
    expect(reasonClass("failed", "Killed: out of memory")).toBe("out of memory or time");
    expect(reasonClass("failed", "no FreeSurfer licence was given")).toBe("a missing licence or secret");
    expect(reasonClass("failed", "the licence secret is not set")).toBe("a missing licence or secret");
    expect(reasonClass("unreported", null)).toBe("no result reported");
    expect(reasonClass("refused", "a file outside the run")).toBe("a file the engine refused");
    expect(reasonClass("failed", "segmentation fault")).toBe("another failure");
  });
  it("turns a run's breaches into the ask of the stacks past each check, from this run's measures alone", () => {
    const c = fixture.cases.find((x) => x.id === "planted-synthseg") as Case;
    const entry = entriesOf(catalog).find((e) => e.id === c.run.pipeline_id) ?? null;
    const r = readingOf(c.run, entry, { items: c.items });
    const doc = breachDocument(r, "t1w") as { sets: Record<string, Record<string, unknown>>; keep: string[] };
    expect(doc.sets.breach_1.where).toEqual([
      ["=", {}, ["field", {}, "measure.synthseg.run"], 12],
      ["<", {}, ["field", {}, "measure.synthseg.qc_general_white_matter"], 0.65],
    ]);
    expect(doc.sets.breach_2.where).toEqual([
      ["=", {}, ["field", {}, "measure.synthseg.run"], 12],
      ["<", {}, ["field", {}, "measure.synthseg.qc_general_csf"], 0.65],
    ]);
    expect(doc.sets.doubtful).toEqual({
      grain: "session",
      algebra: { op: "union", sets: ["breach_1", "breach_2"] },
    });
    expect(doc.sets.look).toEqual({
      grain: "stack",
      of: "doubtful",
      where: [["=", {}, ["axis", {}, "role"], "t1w"]],
    });
    expect(doc.keep).toEqual(["look"]);
    // an item of another run is not this run's
    expect(r.failed.flatMap((f) => f.units)).not.toContain("sub-synth09_ses-1");
  });
});

describe("the fixture set: a run's reading names its failures and proposes a campaign over them", () => {
  for (const c of fixture.cases) {
    it(c.id, async () => {
      const e = await engineFor(c);
      const conversation = `rr-${c.id}`;
      const seam = seamOf(
        e.url,
        { id: "run-read", grant: manifest.grant, ceiling: "reviewer", content: "rows" },
        conversation,
      );
      const listed = (await tool("nils_runs").run({}, toolContext(seam, conversation, "read"))).output as {
        runs: { id: number }[];
      };
      expect(listed.runs.map((r) => r.id)).toEqual([c.run.id]);
      const out = (await tool("read_run").run({ run: c.run.id }, toolContext(seam, conversation, "read", 1)))
        .output as { reading: string; say: string };
      const held = readingById(out.reading);
      if (!held) throw new Error("no reading held");
      const r = held.note.reading;
      expect(r.failed.reduce((k, f) => k + f.count, 0)).toBe(c.expect.failed);
      expect(Object.fromEntries(r.failed.map((f) => [f.reason, f.count]))).toEqual(c.expect.reasons);
      expect(Object.fromEntries(r.breaches.map((b) => [b.check, b.count]))).toEqual(c.expect.breaches);
      expect(r.doubtful_units).toBe(c.expect.doubtful);
      expect(held.note.campaign !== null).toBe(c.expect.campaign);
      if (c.expect.campaign) {
        expect(held.note.ask_document).toBe(600 + c.run.id);
        const campaign = held.note.campaign as {
          name: string;
          source: unknown;
          closes_into: string;
          question: unknown;
        };
        expect(campaign.name).toBe(`${r.name}-run-${r.run}-look`);
        expect(campaign.source).toEqual({ selection: `${campaign.name}@1` });
        expect(campaign.closes_into).toBe("none");
        const drafted = e.seen.find((s) => s.path === "/api/ask/draft")?.body as { text: string };
        expect(JSON.parse(drafted.text).sets.look.where).toEqual([
          ["=", {}, ["axis", {}, "role"], c.expect.role],
        ]);
        expect(held.note.steps[0]).toBe(`save document ${600 + c.run.id} as the selection ${campaign.name}`);
      } else {
        expect(e.seen.some((s) => s.path === "/api/ask/draft")).toBe(false);
      }
      // documents only: no campaign made, no item closed, no run queued again
      expect(e.seen.filter((s) => s.method !== "GET" && s.path !== "/api/ask/draft")).toEqual([]);

      // a summary that names the failures and each broken check settles; one that leaves a check out does not
      const worst = r.breaches
        .map((b) => `${b.count} past ${b.metric} (${b.description ?? b.check})`)
        .join(", ");
      const failed = r.failed.reduce((k, f) => k + f.count, 0);
      const sentence = `Run ${r.run} of ${r.name} ended ${r.status}: ${r.units.succeeded} of ${r.units.total} done; ${failed ? `${failed} failed (${r.failed.map((f) => `${f.count} ${f.reason}`).join(", ")})` : "none failed"}; ${worst || "no check was broken"}.`;
      const result = withNote({ reading: out.reading, sentence }, conversation);
      const note = result.note as { campaign: unknown; failed: unknown[] };
      expect(note.campaign).toEqual(held.note.campaign);
      const checks = runReadChecks();
      const verdict = { result } as unknown as Verdict;
      for (const name of manifest.checks)
        expect([name, await checks[name](verdict, { conversation })]).toEqual([name, null]);
      if (r.breaches.length > 0)
        expect(
          await checks.names_the_checks(
            {
              result: { reading: out.reading, sentence: `Run ${r.run} ended; ${failed} failed.` },
            } as unknown as Verdict,
            { conversation },
          ),
        ).toMatch(/does not name the check on/u);
      expect(
        await checks.proposes_only({ result: { ...result, campaign_id: 3 } } as unknown as Verdict, {
          conversation,
        }),
      ).toMatch(/claims an act/u);
    });
  }

  it("says why when a run cannot be read", async () => {
    const e = await stubEngine(() => ({ status: 404, body: { error: "no pipeline run 99" } }));
    closers.push(e.close);
    const seam = seamOf(
      e.url,
      { id: "run-read", grant: manifest.grant, ceiling: "reviewer", content: "rows" },
      "rr-x",
    );
    const out = (await tool("read_run").run({ run: 99 }, toolContext(seam, "rr-x", "read"))).output as {
      refused: boolean;
      why: string;
    };
    expect(out.refused).toBe(true);
    expect(out.why).toMatch(/^run 99 could not be read: .*no pipeline run 99/u);
  });
});
