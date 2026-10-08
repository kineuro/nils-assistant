// SPDX-License-Identifier: AGPL-3.0-only
// The stations measured (Wave 7a §14, test T10): every station's bench
// questions through a running assistant host and its engine, each scored
// against its golds, one dated result for all of them and a short table.
//
// Each station is measured by the bench script that already scores it, run
// as a child with the endpoints given here, and its file read back:
//
//   ask-help        bench/evals.ts, both corpora: the same answer as the gold, the strict hash beside it
//   concierge       bench/chains.ts through the concierge: the chains that reach their gold
//   analysis-plan   bench/analyses.ts: the plans that name the expected pipeline, parameters and selection
//   run-read        bench/analyses.ts: the readings that count the planted failures and breaches
//   keyword-tune, identity-check, operator
//                   stations/<id>/evals/cases.yml through the generic runner (bench/cases.ts): each
//                   case's message through the station, passed when the run ends as the case says,
//                   with every check passed when it settles, and its result, plan and ledger as the
//                   case expects; a station without that file is reported unmeasured
//
// The endpoints are arguments and default to this machine alone; any other
// host is refused unless --allow-remote says it is the site's own. The model
// is the one the host serves (its ASSISTANT_MODEL and Kvasir's routing):
// --model names it for the record, and the host's own list is kept beside it.
//
//   node dist/bench/measure.js --model <name> [--assistant <url>] [--engine <url>]
//     [--stations a,b,...] [--runs <run>:<case>,...] [--seeded <home>/seeded.json]
//     [--token <token>] [--out <dir>] [--allow-remote]
//
// keyword-tune, analysis-plan, run-read, identity-check and the operator
// need the registry bench/seed.ts builds, which is not the one ask-help's
// golds were derived on: measure them in a second invocation against a host
// over the seeded registry. A run of the same day
// and model adds its stations to the same result file, so the two
// invocations make one result.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { type Case, type LedgerRow, missesOf, resolve as named, planView } from "./cases.ts";
import { report } from "./manifest/split.ts";

export const STATIONS = [
  "concierge",
  "ask-help",
  "keyword-tune",
  "analysis-plan",
  "run-read",
  "identity-check",
  "operator",
] as const;
export type StationId = (typeof STATIONS)[number];

/** One station's score: the bar is passed of of, and the split's two numbers beside it. */
export interface Score {
  station: StationId;
  /** measured, unmeasured (no question set, or a station that needs what this run lacks), or failed (the script broke). */
  state: "measured" | "unmeasured" | "failed";
  /** What a pass means for this station, in a few words. */
  measure: string;
  passed: number;
  of: number;
  loop: { passed: number; of: number } | null;
  held_out: { passed: number; of: number } | null;
  /** Numbers beside the bar: the strict hash, the median seconds, the turns a chain needed. */
  detail: Record<string, unknown>;
  /** The station's own file of the run, relative to the result. */
  file: string | null;
  why: string | null;
  /** The endpoints it was measured through, since two invocations make one result. */
  through?: { assistant: string; engine: string };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** An endpoint as given, refused when it leaves this machine without --allow-remote. */
export function endpoint(raw: string, allowRemote: boolean, what: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${what}: ${raw} is not a URL`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${what}: ${raw} is not http`);
  if (!LOOPBACK.has(u.hostname) && !allowRemote)
    throw new Error(
      `${what}: ${u.hostname} is not this machine; the bench measures the site's own install, so say --allow-remote only for a host of the site, never an outside provider`,
    );
  return u.toString().replace(/\/+$/u, "");
}

/** The model's name as a file name. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

interface Options {
  model: string;
  assistant: string;
  engine: string;
  stations: StationId[];
  runs: string | null;
  token: string;
  out: string;
}

function options(argv: string[]): Options {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: "string" },
      assistant: { type: "string", default: "http://127.0.0.1:7300" },
      engine: { type: "string", default: "http://127.0.0.1:8437" },
      stations: { type: "string" },
      runs: { type: "string" },
      seeded: { type: "string" },
      token: { type: "string" },
      out: { type: "string" },
      "allow-remote": { type: "boolean", default: false },
    },
  });
  if (!values.model) throw new Error("--model names the model the host serves, for the record");
  const allow = values["allow-remote"] === true;
  const stations = (values.stations?.split(",").filter(Boolean) ?? [...STATIONS]) as StationId[];
  for (const s of stations)
    if (!STATIONS.includes(s)) throw new Error(`no station ${s}: ${STATIONS.join(", ")}`);
  let runs = values.runs ?? null;
  if (!runs && values.seeded)
    runs = (JSON.parse(readFileSync(values.seeded, "utf8")) as { RUNS: string }).RUNS;
  return {
    model: values.model,
    assistant: endpoint(values.assistant ?? "", allow, "--assistant"),
    engine: endpoint(values.engine ?? "", allow, "--engine"),
    stations,
    runs,
    token: values.token ?? process.env.NILS_TOKEN ?? "the-persons-token",
    out: resolve(values.out ?? join("bench", "results")),
  };
}

/** One bench script as a child, its output passed through; its exit code. */
function child(script: string, env: Record<string, string>): Promise<number> {
  return new Promise((done) => {
    const p = spawn(process.execPath, [join("dist", "bench", script)], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    p.on("close", (code) => done(code ?? 1));
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

async function measure(o: Options, station: StationId, dir: string, date: string): Promise<Score> {
  const own = join(dir, station);
  mkdirSync(own, { recursive: true });
  const env = { ASSISTANT_URL: o.assistant, NILS_URL: o.engine, NILS_TOKEN: o.token, EVALS_OUT: own };
  const base = { station, loop: null, held_out: null, detail: {}, file: null, why: null };
  const rel = (f: string) => join(station, f);
  const broke = (measure: string, code: number): Score => ({
    ...base,
    state: "failed",
    measure,
    passed: 0,
    of: 0,
    why: `the script exited ${code}`,
  });

  if (station === "ask-help") {
    const measure = "the same answer as the gold";
    const code = await child("evals.js", { ...env, CORPUS: "all" });
    const f = `run-${date}-all.json`;
    if (code !== 0 || !existsSync(join(own, f))) return broke(measure, code);
    const r = JSON.parse(readFileSync(join(own, f), "utf8")) as {
      results: { id: string; passed: boolean; selection: boolean | null; seconds: number }[];
    };
    const same = report((id) => r.results.find((x) => x.id === id)?.selection === true, r.results);
    return {
      ...base,
      state: "measured",
      measure,
      passed: r.results.filter((x) => x.selection === true).length,
      of: r.results.length,
      loop: same.loop,
      held_out: same.held_out,
      detail: {
        strict: r.results.filter((x) => x.passed).length,
        median_seconds: median(r.results.map((x) => x.seconds)),
      },
      file: rel(f),
    };
  }

  if (station === "concierge") {
    const measure = "chains that reach their gold";
    const code = await child("chains.js", { ...env, STATION: "concierge", STABILITY: "none" });
    const f = `chains-${date}.json`;
    if (code !== 0 || !existsSync(join(own, f))) return broke(measure, code);
    const r = JSON.parse(readFileSync(join(own, f), "utf8")) as {
      chains: {
        id: string;
        skipped?: string;
        reached?: boolean;
        corrections_needed?: number | null;
        turns_reached?: number;
        turns_scored?: number;
      }[];
    };
    const scored = r.chains.filter((c) => !c.skipped);
    const passed = (c: (typeof scored)[number]) =>
      c.reached === true || (c.turns_scored !== undefined && c.turns_reached === c.turns_scored);
    const two = report((id) => scored.some((c) => c.id === id && passed(c)), scored);
    return {
      ...base,
      state: "measured",
      measure,
      passed: scored.filter(passed).length,
      of: scored.length,
      loop: two.loop,
      held_out: two.held_out,
      detail: {
        corrections_needed: Object.fromEntries(
          scored.filter((c) => c.reached !== undefined).map((c) => [c.id, c.corrections_needed ?? null]),
        ),
        authored_turns: Object.fromEntries(
          scored
            .filter((c) => c.turns_scored !== undefined)
            .map((c) => [c.id, `${c.turns_reached}/${c.turns_scored}`]),
        ),
      },
      file: rel(f),
    };
  }

  if (station === "analysis-plan" || station === "run-read") {
    const measure =
      station === "analysis-plan"
        ? "plans with the expected pipeline, parameters and selection"
        : "readings that count the planted failures and breaches";
    if (station === "run-read" && !o.runs)
      return {
        ...base,
        state: "unmeasured",
        measure,
        passed: 0,
        of: 0,
        why: "no planted runs: give --runs or --seeded (bench/seed.ts writes them)",
      };
    const code = await child("analyses.js", {
      ...env,
      STATION: station,
      ...(o.runs ? { RUNS: o.runs } : {}),
    });
    const f = `run-${date}.json`;
    if (code !== 0 || !existsSync(join(own, f))) return broke(measure, code);
    const r = JSON.parse(readFileSync(join(own, f), "utf8")) as {
      passed: number;
      of: number;
      split: { loop: { passed: number; of: number }; held_out: { passed: number; of: number } };
      results: { seconds: number }[];
    };
    return {
      ...base,
      state: "measured",
      measure,
      passed: r.passed,
      of: r.of,
      loop: r.split.loop,
      held_out: r.split.held_out,
      detail: { median_seconds: median(r.results.map((x) => x.seconds)) },
      file: rel(f),
    };
  }

  // the generic runner: the station's own cases, when it has them
  const measure = "cases ended as expected, every check passed";
  const at = join("stations", station, "evals", "cases.yml");
  if (!existsSync(at))
    return {
      ...base,
      state: "unmeasured",
      measure,
      passed: 0,
      of: 0,
      why: `no question set: ${at} does not exist`,
    };
  const cases = (parse(readFileSync(at, "utf8")) as { cases: Case[] }).cases;
  const results: {
    id: string;
    passed: boolean;
    why: string;
    gap: string | null;
    terminal: string;
    seconds: number;
    model: unknown;
    conversation: string;
  }[] = [];
  const auth = { authorization: `Bearer ${o.token}` };
  const get = async (url: string) =>
    (await (await fetch(url, { headers: auth })).json()) as Record<string, unknown>;
  const lookup = async (kind: "batch" | "document", name: string): Promise<number | null> => {
    const body = await get(kind === "batch" ? `${o.engine}/api/batches` : `${o.engine}/api/ask/documents`);
    const list = (kind === "batch" ? (body.batches ?? body) : body.documents) as Record<string, unknown>[];
    const found = (Array.isArray(list) ? list : []).find((x) => x.name === name);
    const id = found?.[kind === "batch" ? "id" : "document"];
    return typeof id === "number" ? id : null;
  };
  for (const c of cases) {
    const started = Date.now();
    const conversation = `bench-${c.id}-${Date.now().toString(36)}`;
    const run = (await (
      await fetch(`${o.assistant}/stations/${station}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify({ message: await named(c.message, lookup), conversation }),
      })
    ).json()) as Record<string, unknown>;
    let state = run;
    for (let i = 0; i < 120 && !["settled", "failed", "aborted"].includes(String(state.state)); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      state = await get(`${o.assistant}/runs/${String(run.run)}`);
    }
    const reply = state.reply as { metadata?: { terminal?: string } } | null;
    const terminal = reply?.metadata?.terminal ?? String(state.state);
    const verdict = (await get(`${o.assistant}/runs/${String(run.run)}/verdict`).catch(() => null)) as {
      result?: Record<string, unknown>;
      checks?: { name: string; passed: boolean; why?: string | null }[];
      model?: unknown;
    } | null;
    const planId = verdict?.result?.plan;
    const plan =
      typeof planId === "string"
        ? planView(await get(`${o.assistant}/plans/${encodeURIComponent(planId)}`).catch(() => null))
        : null;
    const kept = await get(`${o.assistant}/ledger/${encodeURIComponent(conversation)}`).catch(
      (): Record<string, unknown> => ({}),
    );
    const ledger = (Array.isArray(kept.rows) ? kept.rows : []) as LedgerRow[];
    const misses = missesOf(c, { terminal, verdict: verdict?.result ? verdict : null, plan, ledger });
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({
      id: c.id,
      passed: misses.length === 0,
      why: misses.join("; "),
      gap: c.gap ?? null,
      terminal,
      seconds,
      model: verdict?.model ?? null,
      conversation,
    });
    console.log(
      `${station} ${c.id}: ${misses.length === 0 ? "pass" : `FAIL (${misses.join("; ")})`} [${terminal}, ${seconds} s]${c.gap ? " (a known gap)" : ""}`,
    );
  }
  const f = `run-${date}.json`;
  writeFileSync(
    join(own, f),
    `${JSON.stringify({ at: new Date().toISOString(), station, results }, null, 2)}\n`,
  );
  const two = report((id) => results.find((r) => r.id === id)?.passed ?? false, results);
  return {
    ...base,
    state: "measured",
    measure,
    passed: results.filter((r) => r.passed).length,
    of: results.length,
    loop: two.loop,
    held_out: two.held_out,
    detail: {
      median_seconds: median(results.map((r) => r.seconds)),
      gaps: results.filter((r) => r.gap).map((r) => ({ id: r.id, passed: r.passed, gap: r.gap })),
    },
    file: rel(f),
  };
}

/** The short table: one line a station, in the order of the stations. */
export function table(scores: Score[]): string {
  const pct = (p: number, of: number) => (of ? `${Math.round((100 * p) / of)} %` : "");
  const split = (s: { passed: number; of: number } | null) => (s ? `${s.passed}/${s.of}` : "");
  const rows = [...scores]
    .sort((a, b) => STATIONS.indexOf(a.station) - STATIONS.indexOf(b.station))
    .map(
      (s) =>
        `| ${s.station} | ${s.state === "measured" ? `${s.passed} of ${s.of}` : s.state} | ${pct(s.passed, s.of)} | ${split(s.loop)} | ${split(s.held_out)} | ${s.state === "measured" ? s.measure : (s.why ?? "")} |`,
    );
  return [
    "| station | passed | share | loop | held out | measure |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

/** A door's capabilities, or a refusal that names the door that did not answer. */
async function capabilities(url: string, token: string, what: string): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${what} at ${url} does not answer (${e instanceof Error ? e.message : String(e)})`);
  }
}

async function main(): Promise<void> {
  const o = options(process.argv.slice(2));
  const date = new Date().toISOString().slice(0, 10);
  const name = `stations-${date}-${slug(o.model)}`;
  const dir = join(o.out, name);
  mkdirSync(dir, { recursive: true });
  // both doors answer before anything is asked of them
  const caps = (await capabilities(`${o.assistant}/capabilities`, o.token, "the assistant host")) as {
    models?: unknown;
  };
  const engine = (await capabilities(`${o.engine}/api/capabilities`, o.token, "the engine")) as {
    engine?: { version?: string };
    packs?: unknown;
  };
  const file = join(o.out, `${name}.json`);
  // a second invocation of the same day and model adds its stations to the same result
  const before = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { stations: Score[] }) : null;
  const scores: Score[] = (before?.stations ?? []).filter((s) => !o.stations.includes(s.station));
  for (const s of o.stations) {
    console.log(`== ${s}`);
    const score = await measure(o, s, dir, date).catch(
      (e: unknown): Score => ({
        station: s,
        state: "failed",
        measure: "",
        passed: 0,
        of: 0,
        loop: null,
        held_out: null,
        detail: {},
        file: null,
        why: String(e instanceof Error ? e.message : e).slice(0, 200),
      }),
    );
    scores.push({
      ...score,
      file: score.file ? join(name, score.file) : null,
      through: { assistant: o.assistant, engine: o.engine },
    });
  }
  const result = {
    at: new Date().toISOString(),
    model: o.model,
    host_models: caps.models ?? null,
    engine: engine.engine?.version ?? null,
    packs: engine.packs ?? null,
    stations: scores.sort((a, b) => STATIONS.indexOf(a.station) - STATIONS.indexOf(b.station)),
  };
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  const t = table(result.stations);
  writeFileSync(join(o.out, `${name}.md`), `# The stations on ${o.model}, ${date}\n\n${t}\n`);
  console.log(`\n${t}\n\n${file}`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("bench", "measure.js")))
  await main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
