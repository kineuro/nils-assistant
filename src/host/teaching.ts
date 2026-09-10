// SPDX-License-Identifier: AGPL-3.0-only
// Teaching (Wave 5 section 9.5, D72): the loop of 4c section 9.9 made
// visible with its gates kept. The corrections the group gave, curated by a
// reviewer into a set; a fine-tune as a job with its recipe recorded, which
// registers a candidate in Kvasir's lifecycle; the admission suite and the
// bench beside each other; promotion a rung-three proposal that is refused
// until both gates are green. No byte of a capture leaves the deployment:
// a correction is identifiers, names, counts and the person's own words.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Lineage } from "./lineage.ts";

export interface Correction {
  id: string;
  kind: "rejected_proposal" | "overturned_station" | "overturned_pack";
  station: string;
  prompt_digest: string;
  correction: string;
  why: string | null;
  at: string;
}

export interface Recipe {
  base: string;
  method: "lora";
  steps: number;
  rank: number;
  lr: number;
}

export interface SetRow {
  id: number;
  name: string;
  subject: string;
  count: number;
  digest: string;
  path: string;
  created_at: number;
}

export type JobState = "running" | "done" | "failed";

export interface FineTuneRow {
  id: number;
  set_id: number;
  subject: string;
  recipe: Recipe;
  state: JobState;
  started_at: number;
  finished_at: number | null;
  outcome: Outcome | null;
  candidate: number | null;
  error: string | null;
}

export interface Outcome {
  dry: boolean;
  base: string;
  steps: number;
  adapter: string | null;
  set_digest: string;
  note: string;
}

export interface BenchRow {
  id: number;
  candidate: number;
  subject: string;
  at: number;
  passed: number;
  of: number;
  strict: number;
  median_seconds: number | null;
  dry: boolean;
  note: string | null;
}

/** What Kvasir's lifecycle door answers for one candidate (C1). */
export interface Candidate {
  id: number;
  model: string;
  backend: string;
  source: { kind: "fine-tune"; job: number | string; recipe: Record<string, unknown> } | { kind: "manual" };
  state: "registered" | "admitted" | "promoted" | "retired";
  admission: {
    suite: string;
    version: string;
    passed: boolean;
    failed: string[];
    record: number | null;
    at: number;
  } | null;
  proposal: { id: number | string; principal: string } | null;
  notes: string | null;
  [k: string]: unknown;
}

/** Kvasir's lifecycle, dialled with the person's own token; the test stubs it. */
export interface KvasirLifecycle {
  list(): Promise<{ candidates: Candidate[]; promoted: { backend: string; model: string | null }[] }>;
  register(body: {
    model: string;
    backend: string;
    source: Candidate["source"];
    notes?: string;
  }): Promise<Candidate>;
  admit(id: number): Promise<{ candidate: Candidate }>;
  promote(id: number, proposal: { id: number | string; principal: string }): Promise<unknown>;
  retire(id: number): Promise<{ candidate: Candidate }>;
}

/** A review item as the engine's review door lists it; only the fields the corrections read. */
export interface ReviewItem {
  id: number;
  kind: string;
  scope: string;
  status: string;
  decided_at?: string | null;
  evidence?: { candidates?: { value?: unknown }[] } | null;
  decision?: {
    axis?: string;
    value?: unknown;
    actor?: string;
    author_kind?: string;
    why?: string | null;
  } | null;
}

/** The runner of a fine-tune: spawns the script and answers its outcome; the test stubs it. */
export type FineTuneRunner = (set: SetRow, recipe: Recipe, outDir: string) => Promise<Outcome>;

/** The bench of a candidate: the authored corpus through the harness when the model is served, else the recorded numbers; the test stubs it. */
export type BenchRunner = (c: Candidate) => Promise<Omit<BenchRow, "id" | "candidate" | "subject" | "at">>;

export class TeachingStore {
  readonly db: DatabaseSync;
  constructor(
    path: string,
    readonly dir: string,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    mkdirSync(join(dir, "sets"), { recursive: true });
    mkdirSync(join(dir, "adapters"), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS curated_set (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      count INTEGER NOT NULL,
      digest TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS finetune (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      recipe TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      outcome TEXT,
      candidate INTEGER,
      error TEXT
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS bench_run (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate INTEGER NOT NULL,
      subject TEXT NOT NULL,
      at INTEGER NOT NULL,
      passed INTEGER NOT NULL,
      of_ INTEGER NOT NULL,
      strict INTEGER NOT NULL,
      median_seconds REAL,
      dry INTEGER NOT NULL,
      note TEXT
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS bench_candidate ON bench_run (candidate, at)");
  }

  /** A set is a JSONL file, one correction per line, in the record format the bench reads (4c section 9.9 captures). */
  curate(name: string, subject: string, corrections: Correction[]): SetRow {
    const lines = corrections.map((c) => JSON.stringify({ trajectory: "correction", ...c }));
    const text = `${lines.join("\n")}\n`;
    // the digest is of the file's bytes, the same the runner takes
    const digest = createHash("sha256").update(text).digest("hex");
    const r = this.db
      .prepare(
        "INSERT INTO curated_set (name, subject, count, digest, path, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(name, subject, corrections.length, digest, "", Date.now());
    const id = Number(r.lastInsertRowid);
    const path = join(this.dir, "sets", `${id}.jsonl`);
    writeFileSync(path, text);
    this.db.prepare("UPDATE curated_set SET path = ? WHERE id = ?").run(path, id);
    return this.set(id) as SetRow;
  }

  set(id: number): SetRow | null {
    return (this.db.prepare("SELECT * FROM curated_set WHERE id = ?").get(id) as SetRow | undefined) ?? null;
  }

  sets(): SetRow[] {
    return this.db.prepare("SELECT * FROM curated_set ORDER BY id DESC").all() as unknown as SetRow[];
  }

  start(setId: number, subject: string, recipe: Recipe): FineTuneRow {
    const r = this.db
      .prepare(
        "INSERT INTO finetune (set_id, subject, recipe, state, started_at) VALUES (?, ?, ?, 'running', ?)",
      )
      .run(setId, subject, JSON.stringify(recipe), Date.now());
    return this.job(Number(r.lastInsertRowid)) as FineTuneRow;
  }

  finish(id: number, outcome: Outcome, candidate: number | null): FineTuneRow {
    this.db
      .prepare("UPDATE finetune SET state = 'done', finished_at = ?, outcome = ?, candidate = ? WHERE id = ?")
      .run(Date.now(), JSON.stringify(outcome), candidate, id);
    return this.job(id) as FineTuneRow;
  }

  fail(id: number, error: string): FineTuneRow {
    this.db
      .prepare("UPDATE finetune SET state = 'failed', finished_at = ?, error = ? WHERE id = ?")
      .run(Date.now(), error.slice(0, 500), id);
    return this.job(id) as FineTuneRow;
  }

  job(id: number): FineTuneRow | null {
    const r = this.db.prepare("SELECT * FROM finetune WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToJob(r) : null;
  }

  jobs(subject: string | null): FineTuneRow[] {
    const rows = (subject === null
      ? this.db.prepare("SELECT * FROM finetune ORDER BY id DESC").all()
      : this.db
          .prepare("SELECT * FROM finetune WHERE subject = ? ORDER BY id DESC")
          .all(subject)) as unknown as Record<string, unknown>[];
    return rows.map(rowToJob);
  }

  benched(o: Omit<BenchRow, "id">): BenchRow {
    const r = this.db
      .prepare(
        "INSERT INTO bench_run (candidate, subject, at, passed, of_, strict, median_seconds, dry, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(o.candidate, o.subject, o.at, o.passed, o.of, o.strict, o.median_seconds, o.dry ? 1 : 0, o.note);
    return this.bench(o.candidate, Number(r.lastInsertRowid)) as BenchRow;
  }

  /** The latest bench of a candidate, or one by id. */
  bench(candidate: number, id?: number): BenchRow | null {
    const r = (
      id === undefined
        ? this.db
            .prepare("SELECT * FROM bench_run WHERE candidate = ? ORDER BY at DESC, id DESC LIMIT 1")
            .get(candidate)
        : this.db.prepare("SELECT * FROM bench_run WHERE id = ?").get(id)
    ) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as number,
      candidate: r.candidate as number,
      subject: r.subject as string,
      at: r.at as number,
      passed: r.passed as number,
      of: r.of_ as number,
      strict: r.strict as number,
      median_seconds: (r.median_seconds as number | null) ?? null,
      dry: r.dry === 1,
      note: (r.note as string | null) ?? null,
    };
  }
}

function rowToJob(r: Record<string, unknown>): FineTuneRow {
  return {
    id: r.id as number,
    set_id: r.set_id as number,
    subject: r.subject as string,
    recipe: JSON.parse(r.recipe as string) as Recipe,
    state: r.state as JobState,
    started_at: r.started_at as number,
    finished_at: (r.finished_at as number | null) ?? null,
    outcome: r.outcome ? (JSON.parse(r.outcome as string) as Outcome) : null,
    candidate: (r.candidate as number | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}

const digest = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** The corrections the group gave: rejected proposals with their reasons, and review decisions by a person that overturned a station or the pack. Never a row. */
export function corrections(
  lineage: Lineage,
  review: ReviewItem[],
  stationDecided: Set<number>,
): Correction[] {
  const out: Correction[] = [];
  const rejected = lineage.db
    .prepare(
      "SELECT p.id, p.document, p.sentence, p.why, p.decided_at, c.station FROM proposal p JOIN conversation c ON c.id = p.conversation WHERE p.decided = 'rejected' ORDER BY p.decided_at DESC LIMIT 500",
    )
    .all() as unknown as {
    id: number;
    document: number;
    sentence: string;
    why: string | null;
    decided_at: number;
    station: string;
  }[];
  for (const r of rejected)
    out.push({
      id: `proposal:${r.id}`,
      kind: "rejected_proposal",
      station: r.station,
      prompt_digest: digest(`proposal:${r.document}:${r.sentence}`),
      correction: `rejected the proposal on document ${r.document}: ${r.sentence}`,
      why: r.why,
      at: new Date(r.decided_at).toISOString(),
    });
  for (const i of review) {
    if (i.status !== "decided" || !i.decision || i.decision.author_kind !== "person") continue;
    const decided = i.decision.value === null ? "no value" : String(i.decision.value ?? "");
    const top = i.evidence?.candidates?.[0]?.value;
    if (stationDecided.has(i.id))
      out.push({
        id: `review:${i.id}:station`,
        kind: "overturned_station",
        station: "review",
        prompt_digest: digest(`review:${i.id}:${i.kind}`),
        correction: `decided ${i.decision.axis ?? i.kind} as ${decided} on item ${i.id}, over a station's decision`,
        why: i.decision.why ?? null,
        at: i.decided_at ?? "",
      });
    else if (top !== undefined && String(top) !== decided)
      out.push({
        id: `review:${i.id}:pack`,
        kind: "overturned_pack",
        station: "pack",
        prompt_digest: digest(`review:${i.id}:${i.kind}`),
        correction: `decided ${i.decision.axis ?? i.kind} as ${decided} on item ${i.id}, where the pack chose ${String(top)}`,
        why: i.decision.why ?? null,
        at: i.decided_at ?? "",
      });
  }
  return out;
}

export function parseRecipe(raw: unknown): Recipe | { refused: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const base = typeof r.base === "string" && r.base.trim() ? r.base.trim() : null;
  if (!base) return { refused: "a recipe names its base model" };
  if (r.method !== undefined && r.method !== "lora")
    return { refused: "the one method this wave knows is lora" };
  const num = (k: string, d: number, min: number, max: number): number | null => {
    const v = r[k] === undefined ? d : Number(r[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  const steps = num("steps", 20, 1, 100_000);
  const rank = num("rank", 8, 1, 512);
  const lr = num("lr", 0.0001, 1e-8, 1);
  if (steps === null || rank === null || lr === null)
    return { refused: "steps, rank and lr are numbers in range" };
  return { base, method: "lora", steps, rank, lr };
}

/** The runner: bench/finetune.py, which fine-tunes when torch and peft are there and records a dry outcome when they are not. */
export function scriptRunner(script: string, python = "python3"): FineTuneRunner {
  return (set, recipe, outDir) =>
    new Promise((resolve, reject) => {
      const p = spawn(python, [script, set.path, JSON.stringify(recipe), outDir], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => {
        out += String(d);
      });
      p.stderr.on("data", (d) => {
        err += String(d);
      });
      p.on("error", reject);
      p.on("close", (code) => {
        const last = out.trim().split("\n").pop() ?? "";
        try {
          const o = JSON.parse(last) as Outcome;
          if (code !== 0 && !o.dry) reject(new Error(`the runner exited ${code}: ${err.slice(0, 200)}`));
          else resolve(o);
        } catch {
          reject(new Error(`the runner said nothing readable (exit ${code}): ${(err || out).slice(0, 200)}`));
        }
      });
    });
}

/** Both gates, and the sentence that refuses promotion while either is not green. */
export function gates(
  c: Candidate,
  bench: BenchRow | null,
  threshold: (of: number) => number,
): { admission: boolean; bench: boolean; refused: string | null } {
  const admission = c.admission?.passed === true;
  const benchGreen = bench !== null && bench.passed >= threshold(bench.of) && bench.of > 0;
  let refused: string | null = null;
  if (!admission && !benchGreen)
    refused = `candidate ${c.id} (${c.model}) is not promoted: the admission suite has not passed and the bench ${bench ? `stands at ${bench.passed} of ${bench.of}` : "has not run"}`;
  else if (!admission)
    refused = `candidate ${c.id} (${c.model}) is not promoted: the admission suite has not passed${c.admission ? ` (${c.admission.failed.join(", ") || "no record"})` : ""}`;
  else if (!benchGreen)
    refused = `candidate ${c.id} (${c.model}) is not promoted: the bench ${bench ? `stands at ${bench.passed} of ${bench.of}, under the ${threshold(bench.of)} it needs` : "has not run"}`;
  return { admission, bench: benchGreen, refused };
}

export interface TeachingDeps {
  store: TeachingStore;
  runner: FineTuneRunner;
  bench: BenchRunner;
  /** The backend a fine-tuned candidate is registered on. */
  backend: string;
  threshold: (of: number) => number;
}

/** The loop, one verb per gate. */
export class Teaching {
  constructor(readonly d: TeachingDeps) {}

  /** A fine-tune as a job: the recipe recorded first, the runner spawned, the candidate registered in Kvasir when it ends. Returns the job at once; `done` settles when it ends. */
  fineTune(
    set: SetRow,
    subject: string,
    recipe: Recipe,
    kvasir: KvasirLifecycle,
  ): { job: FineTuneRow; done: Promise<FineTuneRow> } {
    const job = this.d.store.start(set.id, subject, recipe);
    const outDir = join(this.d.store.dir, "adapters", String(job.id));
    mkdirSync(outDir, { recursive: true });
    const done = (async () => {
      try {
        const outcome = await this.d.runner(set, recipe, outDir);
        const model = outcome.adapter ? `${recipe.base}+lora-set${set.id}-job${job.id}` : recipe.base;
        const c = await kvasir.register({
          model,
          backend: this.d.backend,
          source: {
            kind: "fine-tune",
            job: job.id,
            recipe: { ...recipe, set: set.id, set_digest: set.digest, dry: outcome.dry },
          },
          notes: `from set ${set.id} (${set.name}, ${set.count} corrections)${outcome.dry ? "; dry: no adapter was made" : ""}`,
        });
        return this.d.store.finish(job.id, outcome, c.id);
      } catch (e) {
        return this.d.store.fail(job.id, e instanceof Error ? e.message : String(e));
      }
    })();
    return { job, done };
  }

  async bench(c: Candidate, subject: string): Promise<BenchRow> {
    const r = await this.d.bench(c);
    return this.d.store.benched({ candidate: c.id, subject, at: Date.now(), ...r });
  }

  /** Promotion: refused with a sentence until both gates are green; then Kvasir's promote with the proposal. */
  async promote(
    c: Candidate,
    proposal: { id: number | string; principal: string },
    kvasir: KvasirLifecycle,
  ): Promise<{ ok: true; result: unknown } | { ok: false; refused: string }> {
    const g = gates(c, this.d.store.bench(c.id), this.d.threshold);
    if (g.refused) return { ok: false, refused: g.refused };
    return { ok: true, result: await kvasir.promote(c.id, proposal) };
  }

  /** Every candidate with both gates beside each other. */
  async candidates(kvasir: KvasirLifecycle): Promise<{
    candidates: (Candidate & {
      bench: BenchRow | null;
      gates: ReturnType<typeof gates>;
      job: FineTuneRow | null;
    })[];
    promoted: { backend: string; model: string | null }[];
  }> {
    const l = await kvasir.list();
    const jobs = this.d.store.jobs(null);
    return {
      candidates: l.candidates.map((c) => {
        const bench = this.d.store.bench(c.id);
        return {
          ...c,
          bench,
          gates: gates(c, bench, this.d.threshold),
          job: jobs.find((j) => j.candidate === c.id) ?? null,
        };
      }),
      promoted: l.promoted,
    };
  }
}

/** Kvasir's lifecycle over HTTP with a bearer, the person's own. */
export function kvasirLifecycle(
  url: string,
  token: string | null,
  dial: typeof fetch = fetch,
): KvasirLifecycle {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const r = await dial(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } | string };
    if (!r.ok) {
      const e = j.error;
      throw new KvasirRefused(
        r.status,
        typeof e === "string" ? e : (e?.message ?? `Kvasir answered ${r.status}`),
      );
    }
    return j;
  };
  return {
    list: () =>
      call("GET", "/v1/models/lifecycle?events=1") as Promise<{
        candidates: Candidate[];
        promoted: { backend: string; model: string | null }[];
      }>,
    register: async (body) =>
      ((await call("POST", "/v1/models/lifecycle", body)) as { candidate: Candidate }).candidate,
    admit: (id) => call("POST", `/v1/models/lifecycle/${id}/admit`, {}) as Promise<{ candidate: Candidate }>,
    promote: (id, proposal) => call("POST", `/v1/models/lifecycle/${id}/promote`, { proposal }),
    retire: (id) =>
      call("POST", `/v1/models/lifecycle/${id}/retire`, {}) as Promise<{ candidate: Candidate }>,
  };
}

export class KvasirRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The recorded bench: when a candidate's base model has a baseline recording under bench/gate, its numbers stand for the model; else the bench is dry at zero and says so. */
export function recordedBench(gateDir: string, read: (p: string) => string | null): BenchRunner {
  return async (c) => {
    const tag = c.model.split("+")[0].replace(/[^a-z0-9.-]+/giu, "-");
    const text = read(join(gateDir, `baseline-${tag}.json`));
    if (!text)
      return {
        passed: 0,
        of: 0,
        strict: 0,
        median_seconds: null,
        dry: true,
        note: `no recording for ${c.model}; the model is not served, so the bench is dry`,
      };
    const rec = JSON.parse(text) as { results: { passed: boolean; seconds?: number }[] };
    const passed = rec.results.filter((r) => r.passed).length;
    const secs = rec.results
      .map((r) => r.seconds ?? 0)
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
    return {
      passed,
      of: rec.results.length,
      strict: passed,
      median_seconds: secs.length ? secs[Math.floor(secs.length / 2)] : null,
      dry: true,
      note: `from the recording of ${tag}, not a live run`,
    };
  };
}
