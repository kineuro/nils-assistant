// SPDX-License-Identifier: AGPL-3.0-only
// analysis-plan (record 49 A5): the manifest and its grant, the catalog read
// for choosing, the parameters held to the descriptor, the ask a set of
// cohorts becomes, and every case of the station's fixture set played
// through plan_run against a stub engine: each question becomes a runnable
// document (the pipeline, the selection, the parameters, the pre-flight and
// the job's command line) and the checks pass on it. Nothing is queued.

import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { analysisPlanChecks, analysisPlanTools, planById, withRun } from "../src/stations/analysis-plan.ts";
import { loadManifests } from "../src/stations/manifest.ts";
import {
  catalogText,
  cohortDocument,
  entriesOf,
  paramsFor,
  preflightOf,
  resolve,
  runCommand,
} from "../src/stations/pipelines.ts";
import type { Verdict } from "../src/stations/verdict.ts";
import { type Dialled, seamOf, stubEngine, toolContext } from "./child/stub-engine.ts";

interface Case {
  id: string;
  question: string;
  expect: {
    plan?: false;
    pipeline?: string;
    params?: Record<string, unknown>;
    cohorts?: string[];
    sessions?: "all" | "first" | "latest";
    selection?: string;
  };
  preflight?: { total: number; ready: number; missing: { why: string; units: number }[]; minutes: number };
}

const catalog = JSON.parse(readFileSync("bench/analyses/catalog.json", "utf8"));
const fixture = parse(readFileSync("stations/analysis-plan/evals/cases.yml", "utf8")) as {
  cohorts: { name: string; subjects: number; sessions: number }[];
  selections: string[];
  cases: Case[];
};
const manifest = loadManifests(["./stations"]).get("analysis-plan");
if (!manifest) throw new Error("no analysis-plan manifest");

/** The engine's pre-flight answer for a case, as POST /api/pipelines/{name}/preflight gives it. */
function preflightAnswer(c: Case, pipeline: string, handle: number, selection: string | null) {
  const p = c.preflight ?? { total: 0, ready: 0, missing: [], minutes: 0 };
  const missing = p.missing.flatMap((m) =>
    Array.from({ length: m.units }, (_, i) => ({ unit: `sub-synth${i}_ses-1`, why: m.why })),
  );
  return {
    pipeline,
    handle,
    selection,
    units: { total: p.total, ready: p.ready, missing: missing.length },
    missing,
    left_out: { stacks: 3, why: "no pick takes them" },
    estimate: { seconds_per_unit: 300, source: "descriptor", runs: 0, slots: 4, seconds: p.minutes * 60 },
    gpu: { need: "none", available: false, device: null },
    budget: { cores: 48, memory_gb: 512, source: "ruling", fits: true },
    runtime: { name: "podman" },
    ready: p.ready > 0,
    blockers: p.ready > 0 ? [] : ["no unit is ready"],
  };
}

const closers: (() => void)[] = [];
afterAll(() => {
  for (const c of closers) c();
});

async function engineFor(c: Case) {
  let n = 0;
  const e = await stubEngine((call: Dialled) => {
    const path = call.path.replace(/\?.*$/u, "");
    if (call.method === "GET" && path === "/api/pipelines") return { body: catalog };
    if (call.method === "GET" && path === "/api/cohorts") return { body: fixture.cohorts };
    if (call.method === "POST" && path === "/api/ask/draft") return { body: { document: 700 + ++n } };
    if (call.method === "POST" && path === "/api/ask/run")
      return { body: { handle: 800 + n, truncated: false } };
    const m = /^\/api\/pipelines\/([^/]+)\/preflight$/u.exec(path);
    if (call.method === "POST" && m) {
      const body = call.body as { select?: string; handle?: number };
      if (body.select && !fixture.selections.includes(body.select.replace(/^selection:/u, "")))
        return { status: 400, body: { error: `no selection ${body.select}` } };
      return {
        body: preflightAnswer(c, decodeURIComponent(m[1]), body.handle ?? 900, body.select ?? null),
      };
    }
    return null;
  });
  closers.push(e.close);
  return e;
}

const tool = (name: string) => {
  const t = analysisPlanTools().find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("analysis-plan's manifest", () => {
  it("reads the catalog, the cohorts and the pre-flight, drafts an ask, and holds no door that runs or decides", () => {
    expect(manifest.purpose).toBe("assistant.analysis-plan");
    expect(manifest.content).toBe("rows");
    expect(manifest.ceiling).toBe("reviewer");
    expect(Object.keys(manifest.grant).sort()).toEqual([
      "cohorts",
      "draft",
      "pipelines",
      "pipelines/{name}/preflight",
      "run",
    ]);
    // a run is queued at POST /api/jobs and a campaign at POST /api/campaigns: a person's acts
    for (const door of ["jobs", "campaigns", "selections/{name}", "pipeline-runs"])
      expect(manifest.grant).not.toHaveProperty(door);
    expect(manifest.writes).toEqual(["document_version"]);
    expect(manifest.checks).toEqual(["no_sql", "planned", "preflight_read", "sentence_true", "runs_nothing"]);
  });
});

describe("the catalog, read for choosing", () => {
  const entries = entriesOf(catalog);
  it("lists every starter with its level, inputs, parameters, measures and checks", () => {
    expect(entries.map((e) => e.name).sort()).toEqual([
      "freesurfer-recon-all",
      "mriqc",
      "n4-bias-correction",
      "samseg-lesions",
      "synthseg",
      "synthstrip",
    ]);
    const text = catalogText(entries);
    expect(text).toContain("samseg-lesions@1");
    expect(text).toContain("lesion (on|off, default on)");
    expect(text).toContain("inputs t1w and flair");
    expect(text).toContain("measure.synthseg.<name>");
    expect(text).toContain("left_hippocampus");
    expect(text).toContain("qc_general_white_matter >= 0.65");
    expect(text).toContain("needs the secret freesurfer_license");
  });
  it("resolves a name to its newest version, and name@version and an id exactly", () => {
    expect(resolve(entries, "synthseg")?.label).toBe("synthseg@1");
    expect(resolve(entries, "synthseg@1")?.name).toBe("synthseg");
    expect(resolve(entries, "synthseg@2")).toBeNull();
    expect(resolve(entries, "3")?.name).toBe(entries.find((e) => e.id === 3)?.name);
  });
  it("holds parameters to the descriptor: defaults filled, types, choices and ranges kept, unknown ids refused", () => {
    const samseg = resolve(entries, "samseg-lesions");
    if (!samseg) throw new Error("no samseg");
    expect(paramsFor(samseg, { lesion: "off" })).toEqual({
      params: { lesion: "off", pallidum_separate: true, threads: 4 },
      refused: [],
    });
    expect(paramsFor(samseg, { lesion: "maybe" }).refused[0]).toBe("lesion is one of on, off, not maybe");
    expect(paramsFor(samseg, { threads: 64 }).refused[0]).toBe("threads is from 1 to 32, not 64");
    expect(paramsFor(samseg, { threads: "2" }).params.threads).toBe(2);
    expect(paramsFor(samseg, { pallidum_separate: "no" }).params.pallidum_separate).toBe(false);
    expect(paramsFor(samseg, { flair: true }).refused[0]).toMatch(
      /^samseg-lesions declares no parameter flair; it declares lesion, pallidum_separate, threads$/u,
    );
  });
  it("writes the ask of a set of cohorts as stacks of their sessions, all or each subject's first or latest, projecting only a stack's id", () => {
    const all = cohortDocument(["nmosd"], "all", "x") as { sets: Record<string, Record<string, unknown>> };
    expect(all.sets.scope.where).toEqual([["=", {}, ["field", {}, "name"], "nmosd"]]);
    expect(all.sets.visits).toEqual({ grain: "session", of: "people" });
    expect(all.sets.stacks).toEqual({ grain: "stack", of: "visits" });
    const latest = cohortDocument(["a", "b"], "latest", "y") as {
      sets: Record<string, Record<string, unknown>>;
      out: unknown;
    };
    expect(latest.sets.scope.where).toEqual([["in", {}, ["field", {}, "name"], ["a", "b"]]]);
    expect((latest.sets.visits.pick as { by: unknown[] }).by[0]).toEqual([["field", {}, "first"], "desc"]);
    expect(latest.out).toEqual({ set: "stacks", level: "record", columns: [["field", {}, "id"]] });
  });
  it("reads a pre-flight as counts and reasons, never a unit's name", () => {
    const c = fixture.cases.find((x) => x.id === "lesions-ms-a-over-time") as Case;
    const p = preflightOf(preflightAnswer(c, "samseg-lesions@1", 5, null));
    expect(p.units).toEqual({ total: 71, ready: 58, missing: 13 });
    expect(p.missing_by_why).toEqual([{ why: "no live pick of role flair", units: 13 }]);
    expect(p.estimate.words).toBe("about 53.3 h");
    expect(JSON.stringify(p)).not.toContain("sub-");
    expect(runCommand("samseg-lesions@1", { handle: 5 }, { lesion: "on" })).toEqual([
      "run",
      "samseg-lesions@1",
      "--handle",
      "5",
      "--param",
      "lesion=on",
    ]);
  });
});

describe("the fixture set: each question becomes a runnable document", () => {
  for (const c of fixture.cases) {
    it(c.id, async () => {
      const e = await engineFor(c);
      const conversation = `ap-${c.id}`;
      const seam = seamOf(
        e.url,
        { id: "analysis-plan", grant: manifest.grant, ceiling: "reviewer", content: "rows" },
        conversation,
      );
      const args: Record<string, unknown> = {
        question: c.question,
        pipeline: c.expect.pipeline ?? "synthseg",
        why: "it measures what was asked",
        ...(c.expect.params ? { params: c.expect.params } : {}),
        ...(c.expect.selection ? { selection: c.expect.selection } : {}),
        ...(c.expect.cohorts ? { cohorts: c.expect.cohorts, sessions: c.expect.sessions } : {}),
      };
      if (c.expect.plan === false) {
        // the cohort the question names is not listed: no plan, and the refusal names the cohorts there are
        const out = (
          await tool("plan_run").run(
            { ...args, cohorts: ["als"], sessions: "all" },
            toolContext(seam, conversation, "read"),
          )
        ).output as { refused?: boolean; why?: string };
        expect(out.refused).toBe(true);
        expect(out.why).toBe("no cohort named als; the cohorts are ms-cohort-a, ms-cohort-b, nmosd");
        expect(e.seen.some((s) => s.path.startsWith("/api/ask/draft"))).toBe(false);
        return;
      }
      const out = (await tool("plan_run").run(args, toolContext(seam, conversation, "read"))).output as {
        plan: string;
        say: string;
      };
      expect(typeof out.plan).toBe("string");
      const held = planById(out.plan);
      if (!held) throw new Error("no plan held");
      const d = held.document;
      const p = held.summary;
      // the desk's shape: pipeline as name@version, select or handle, params, preflight, why, question
      expect(d.pipeline).toBe(`${c.expect.pipeline}@1`);
      expect(d.question).toBe(c.question);
      expect(d.why).toBe("it measures what was asked");
      for (const [k, v] of Object.entries(c.expect.params ?? {})) expect(d.params[k]).toBe(v);
      const engine = d.preflight as { units: { total: number; ready: number }; missing: unknown[] };
      expect(engine.units.total).toBe(c.preflight?.total);
      expect(engine.units.ready).toBe(c.preflight?.ready);
      // each missing unit by its reason alone, as the engine says it below detail quasi
      for (const m of engine.missing) expect(Object.keys(m as object)).toEqual(["why"]);
      expect(JSON.stringify(d)).not.toContain("sub-");
      expect(p?.units.ready).toBe(c.preflight?.ready);
      expect(d.command?.[0]).toBe("run");
      expect(d.command?.[1]).toBe(`${c.expect.pipeline}@1`);
      if (c.expect.selection) {
        expect(d.select).toBe(c.expect.selection);
        expect(d.handle).toBeUndefined();
        expect(d.proposed).toBeUndefined();
        expect(d.command).toContain(c.expect.selection);
        expect(e.seen.some((s) => s.path === "/api/ask/draft")).toBe(false);
      } else {
        expect(d.select).toBeUndefined();
        expect(typeof d.handle).toBe("number");
        expect(d.proposed?.cohorts).toEqual(c.expect.cohorts);
        expect(d.proposed?.sessions).toBe(c.expect.sessions);
        expect(d.command).toEqual(expect.arrayContaining(["--handle", String(d.handle)]));
        const drafted = e.seen.find((s) => s.path === "/api/ask/draft")?.body as { text: string };
        const doc = JSON.parse(drafted.text) as { sets: { scope: { where: unknown[] } } };
        expect(JSON.stringify(doc.sets.scope.where)).toContain(c.expect.cohorts?.[0] ?? "");
      }
      // nothing is queued: no job, no campaign, no selection saved
      expect(e.seen.filter((s) => /\/api\/(jobs|campaigns|ask\/selections)/u.test(s.path))).toEqual([]);
      const name = c.expect.pipeline ?? "";
      const sentence = `${name} measures it; ${p?.units.ready} of ${p?.units.total} units are ready, ${p?.estimate.words}. Press Run to start it.`;
      const result = withRun({ plan: out.plan, sentence }, conversation);
      expect(result.run_document).toBe(d);
      const verdict = { result } as unknown as Verdict;
      const checks = analysisPlanChecks();
      for (const name of manifest.checks)
        expect([name, await checks[name](verdict, { conversation })]).toEqual([name, null]);
      // a sentence without the engine's count is sent back
      expect(
        await checks.sentence_true({ result: { plan: out.plan, sentence: name } } as unknown as Verdict, {
          conversation,
        }),
      ).toMatch(/does not say/u);
      // another conversation's plan is not this one's
      expect(await checks.planned(verdict, { conversation: "someone-else" })).toMatch(
        /not this conversation's/u,
      );
    });
  }

  it("refuses whom-to-run-over given twice or not at all, and a parameter out of range, before dialling the pre-flight", async () => {
    const c = fixture.cases[0];
    const e = await engineFor(c);
    const seam = seamOf(
      e.url,
      { id: "analysis-plan", grant: manifest.grant, ceiling: "reviewer", content: "rows" },
      "ap-refusals",
    );
    const run = (args: Record<string, unknown>) =>
      tool("plan_run").run(
        { question: "q", pipeline: "synthseg", why: "w", ...args },
        toolContext(seam, "ap-refusals", "read"),
      );
    expect(
      ((await run({ selection: "ms-baseline@1", cohorts: ["nmosd"] })).output as { why: string }).why,
    ).toMatch(/not both, not neither/u);
    expect(((await run({})).output as { why: string }).why).toMatch(/not both, not neither/u);
    expect(((await run({ cohorts: ["nmosd"], params: { threads: 0 } })).output as { why: string }).why).toBe(
      "threads is from 1 to 32, not 0",
    );
    expect(
      ((await run({ pipeline: "fastsurfer", cohorts: ["nmosd"] })).output as { why: string }).why,
    ).toMatch(/^no pipeline fastsurfer in the catalog; it holds /u);
    // a saved selection the engine does not know is refused with the engine's words, not planned
    expect(((await run({ selection: "nobody@1" })).output as { why: string }).why).toMatch(/no selection/u);
    expect(e.seen.filter((s) => s.path.endsWith("/preflight")).length).toBe(1);
  });
});
