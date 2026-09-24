// SPDX-License-Identifier: AGPL-3.0-only
// The bench of the two analysis stations (record 49 A5 and A6), live: each
// case of a station's fixture set through the station, headless, against a
// running host and an engine that serves the pipeline doors, and the
// verdict scored against the case. Both splits are reported.
//
// analysis-plan: the question goes in; a case passes when the run document
// names the expected pipeline, the expected parameters, the expected
// selection (a saved one, or the cohorts and which sessions) and carries
// the engine's pre-flight; a case whose answer is no plan passes when the
// station settles without one.
//
// run-read: RUNS maps the engine's run ids to the fixture's cases
// (`RUNS=12:planted-synthseg,14:samseg-both-sides`), since a live run's id
// is the engine's; a case passes when the note counts the failures by
// reason and the breaches by check as the case says, and proposes a
// campaign exactly when it should.
//
// STATION names the station (analysis-plan by default); ONLY limits the cases.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { report } from "./manifest/split.ts";

const host = (process.env.ASSISTANT_URL ?? "http://127.0.0.1:7300").replace(/\/+$/u, "");
const token = process.env.NILS_TOKEN ?? "the-persons-token";
const station = process.env.STATION ?? "analysis-plan";
const only = process.env.ONLY?.split(",").filter(Boolean);
const root = process.cwd();
const auth = { authorization: `Bearer ${token}` };

async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(url, init);
  return (await r.json()) as Record<string, unknown>;
}

/** One message through the station, headless: the verdict's result, or null, and how the run ended. */
async function ask(
  message: string,
  conversation: string,
): Promise<{ result: Record<string, unknown> | null; terminal: string; seconds: number }> {
  const started = Date.now();
  const run = await json(`${host}/stations/${station}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ message, conversation }),
  });
  let state: Record<string, unknown> = run;
  for (let i = 0; i < 120 && !["settled", "failed", "aborted"].includes(String(state.state)); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    state = await json(`${host}/runs/${run.run}`);
  }
  const reply = state.reply as { metadata?: { terminal?: string } } | null;
  const terminal = reply?.metadata?.terminal ?? String(state.state);
  const verdict = (await json(`${host}/runs/${run.run}/verdict`).catch(() => ({}))) as {
    result?: Record<string, unknown>;
  };
  return { result: verdict.result ?? null, terminal, seconds: Math.round((Date.now() - started) / 1000) };
}

interface Scored {
  id: string;
  passed: boolean;
  why: string;
  terminal: string;
  seconds: number;
  conversation: string;
  sentence: string | null;
}

const same = (a: unknown[], b: unknown[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

async function analysisPlan(): Promise<Scored[]> {
  const fixture = parse(
    readFileSync(join(root, "stations", "analysis-plan", "evals", "cases.yml"), "utf8"),
  ) as {
    cases: {
      id: string;
      question: string;
      expect: {
        plan?: false;
        pipeline?: string;
        params?: Record<string, unknown>;
        cohorts?: string[];
        sessions?: string;
        selection?: string;
      };
    }[];
  };
  const out: Scored[] = [];
  for (const c of fixture.cases.filter((x) => !only || only.includes(x.id))) {
    const conversation = `bench-${c.id}-${Date.now().toString(36)}`;
    const { result, terminal, seconds } = await ask(c.question, conversation);
    const run = result?.run_document as
      | {
          pipeline?: string;
          params?: Record<string, unknown>;
          select?: string;
          handle?: number;
          proposed?: { cohorts?: string[]; sessions?: string };
          preflight?: unknown;
        }
      | undefined;
    const name = run?.pipeline?.replace(/@\d+$/u, "");
    const misses: string[] = [];
    if (c.expect.plan === false) {
      if (run) misses.push(`planned ${run.pipeline} where no plan was right`);
    } else if (!run) misses.push(`no run document (${terminal})`);
    else {
      if (name !== c.expect.pipeline) misses.push(`${run.pipeline} for ${c.expect.pipeline}`);
      for (const [k, v] of Object.entries(c.expect.params ?? {}))
        if (String(run.params?.[k]) !== String(v))
          misses.push(`${k} ${String(run.params?.[k])} for ${String(v)}`);
      if (c.expect.selection && run.select !== c.expect.selection)
        misses.push(`over ${run.select ?? JSON.stringify(run.proposed)} for ${c.expect.selection}`);
      if (c.expect.cohorts) {
        const p = run.proposed;
        if (!p || !same(p.cohorts ?? [], c.expect.cohorts) || p.sessions !== c.expect.sessions)
          misses.push(
            `over ${run.select ?? JSON.stringify(p)} for ${c.expect.cohorts.join("+")} ${c.expect.sessions}`,
          );
      }
      if (!run.preflight) misses.push("no pre-flight");
    }
    out.push({
      id: c.id,
      passed: misses.length === 0,
      why: misses.join("; "),
      terminal,
      seconds,
      conversation,
      sentence: typeof result?.sentence === "string" ? result.sentence : null,
    });
    console.log(
      `${c.id}: ${misses.length === 0 ? "pass" : `FAIL (${misses.join("; ")})`} [${terminal}, ${seconds} s]`,
    );
  }
  return out;
}

async function runRead(): Promise<Scored[]> {
  const fixture = JSON.parse(
    readFileSync(join(root, "stations", "run-read", "evals", "runs.json"), "utf8"),
  ) as {
    cases: {
      id: string;
      expect: {
        failed: number;
        reasons: Record<string, number>;
        breaches: Record<string, number>;
        campaign: boolean;
      };
    }[];
  };
  const runs = (process.env.RUNS ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => p.split(":") as [string, string]);
  if (runs.length === 0)
    throw new Error("RUNS names the engine's run ids and their cases: RUNS=12:planted-synthseg");
  const out: Scored[] = [];
  for (const [run, id] of runs) {
    const c = fixture.cases.find((x) => x.id === id);
    if (!c || (only && !only.includes(id))) continue;
    const conversation = `bench-${id}-${Date.now().toString(36)}`;
    const { result, terminal, seconds } = await ask(`Read run ${run}.`, conversation);
    const note = result?.note as
      | {
          failed?: { reason: string; count: number }[];
          breaches?: { check: string; count: number }[];
          campaign?: unknown;
        }
      | undefined;
    const misses: string[] = [];
    if (!note) misses.push(`no note (${terminal})`);
    else {
      const reasons = Object.fromEntries((note.failed ?? []).map((f) => [f.reason, f.count]));
      const breaches = Object.fromEntries((note.breaches ?? []).map((b) => [b.check, b.count]));
      if (JSON.stringify(reasons) !== JSON.stringify(c.expect.reasons))
        misses.push(`failures ${JSON.stringify(reasons)}`);
      if (JSON.stringify(breaches) !== JSON.stringify(c.expect.breaches))
        misses.push(`breaches ${JSON.stringify(breaches)}`);
      if (Boolean(note.campaign) !== c.expect.campaign) misses.push(`campaign ${Boolean(note.campaign)}`);
    }
    out.push({
      id,
      passed: misses.length === 0,
      why: misses.join("; "),
      terminal,
      seconds,
      conversation,
      sentence: typeof result?.sentence === "string" ? result.sentence : null,
    });
    console.log(
      `${id}: ${misses.length === 0 ? "pass" : `FAIL (${misses.join("; ")})`} [${terminal}, ${seconds} s]`,
    );
  }
  return out;
}

const results = station === "run-read" ? await runRead() : await analysisPlan();
const two = report((id) => results.find((r) => r.id === id)?.passed ?? false, results);
const passed = results.filter((r) => r.passed).length;
console.log(
  `${station}: ${passed} of ${results.length} (loop ${two.loop.passed}/${two.loop.of}, held out ${two.held_out.passed}/${two.held_out.of})`,
);
writeFileSync(
  join(
    process.env.EVALS_OUT ?? join(root, "stations", station, "evals"),
    `run-${new Date().toISOString().slice(0, 10)}.json`,
  ),
  `${JSON.stringify({ at: new Date().toISOString(), station, passed, of: results.length, split: two, results }, null, 2)}\n`,
);
