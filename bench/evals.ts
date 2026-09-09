// SPDX-License-Identifier: AGPL-3.0-only
// The evals of ask-help (Wave 4c §9.11, D4): the shapes of the corpus
// through the station, headless, against a running host; the verdict's
// document is run by the engine and its content hash compared to the gold.
// Both splits are reported beside the one-shot baseline. The chains follow
// in a later pass.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { report } from "./manifest/split.ts";

const host = (process.env.ASSISTANT_URL ?? "http://127.0.0.1:7300").replace(/\/+$/u, "");
const nils = (process.env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, "");
const token = process.env.NILS_TOKEN ?? "the-persons-token";
const only = process.env.ONLY?.split(",").filter(Boolean);
const root = process.cwd();

interface Shape {
  id: string;
  question: string;
  rebased: { status: string; gold?: string };
}
const shapes = (
  parse(readFileSync(join(root, "bench", "corpus", "shapes.yml"), "utf8")) as { shapes: Shape[] }
).shapes.filter((s) => s.rebased.gold && (!only || only.includes(s.id)));
const expect = JSON.parse(readFileSync(join(root, "bench", "gold", "expect.json"), "utf8")) as Record<
  string,
  { content_hash: string | null; row_count: number }
>;

async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(url, init);
  return (await r.json()) as Record<string, unknown>;
}

/** The values of one column of a handle, every page, as a sorted list; null when the handle has no such column. */
async function column(handle: number, name: string): Promise<string[] | null> {
  const out: string[] = [];
  for (let page = 1; page < 200; page++) {
    const r = await json(`${nils}/api/ask/handles/${handle}/rows?page=${page}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const cols = (r.columns as (string | { name: string })[] | undefined) ?? [];
    const i = cols.findIndex((c) => (typeof c === "string" ? c : c.name) === name);
    if (i < 0) return null;
    for (const row of (r.rows as unknown[][] | undefined) ?? []) out.push(String(row[i]));
    if (typeof r.pages !== "number" || page >= r.pages) break;
  }
  return out.sort();
}

/** The looser measure beside the hash: the same subjects selected, by the code column, when both sides carry one. */
async function sameSelection(handle: number, goldFile: string): Promise<boolean | null> {
  const goldText = readFileSync(join(root, "bench", "gold", goldFile), "utf8");
  const stored = await json(`${nils}/api/ask/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: goldText }),
  });
  if (typeof stored.document !== "number") return null;
  const ran = await json(`${nils}/api/ask/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ document_id: stored.document }),
  });
  if (typeof ran.handle !== "number") return null;
  const [a, b] = await Promise.all([column(handle, "code"), column(ran.handle, "code")]);
  if (!a || !b) return null;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

const results: {
  id: string;
  passed: boolean;
  /** The same subjects selected, by code, when the hash differs; null when the measure does not apply. */
  selection: boolean | null;
  why: string;
  document: number | null;
  seconds: number;
  terminal: string | null;
}[] = [];
for (const s of shapes) {
  const started = Date.now();
  const conversation = `eval-${s.id}-${Date.now().toString(36)}`;
  const run = await json(`${host}/stations/ask-help/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: s.question, conversation }),
  });
  let state: Record<string, unknown> = run;
  for (let i = 0; i < 120 && !["settled", "failed", "aborted"].includes(String(state.state)); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    state = await json(`${host}/runs/${run.run}`);
  }
  const reply = state.reply as { text?: string; metadata?: { terminal?: string } } | null;
  const terminal = reply?.metadata?.terminal ?? (state.state === "settled" ? "settled" : String(state.state));
  // the verdict lives in the run's durable state; the host answers it beside the run
  const verdict = (await json(`${host}/runs/${run.run}/verdict`).catch(() => ({}))) as {
    result?: { document?: number; hash?: string; sentence?: string };
  };
  const document = verdict.result?.document ?? null;
  let passed = false;
  let selection: boolean | null = null;
  let why = "";
  if (document === null) why = `no verdict (${terminal}${reply?.text ? `: ${reply.text.slice(0, 80)}` : ""})`;
  else {
    const ran = await json(`${nils}/api/ask/run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ document_id: document }),
    });
    const want = expect[s.rebased.gold ?? ""];
    if (ran.error) why = `the engine refused document ${document}: ${String(ran.error).slice(0, 100)}`;
    else if (want?.content_hash && ran.content_hash === want.content_hash) {
      passed = true;
      selection = true;
    } else {
      selection =
        typeof ran.handle === "number" && ran.row_count === want?.row_count
          ? await sameSelection(ran.handle, s.rebased.gold ?? "").catch(() => null)
          : false;
      why = `document ${document}: ${ran.row_count} rows, the gold has ${want?.row_count}${selection ? ", the same subjects" : ""}; ${verdict.result?.sentence?.slice(0, 100) ?? ""}`;
    }
  }
  results.push({
    id: s.id,
    passed,
    selection,
    why,
    document,
    seconds: Math.round((Date.now() - started) / 1000),
    terminal,
  });
  console.log(
    `${s.id}: ${passed ? "pass" : `FAIL (${why})`} [${terminal}, ${Math.round((Date.now() - started) / 1000)} s]`,
  );
}
const two = report((id) => results.find((r) => r.id === id)?.passed ?? false, results);
const all = results.filter((r) => r.passed).length;
const selected = results.filter((r) => r.selection === true).length;
console.log(
  `ask-help: ${all} of ${results.length} (${((100 * all) / Math.max(1, results.length)).toFixed(1)} percent); loop ${two.loop.passed}/${two.loop.of}, held out ${two.held_out.passed}/${two.held_out.of}; the same subjects selected in ${selected} of ${results.length}`,
);
writeFileSync(
  join(
    process.env.EVALS_OUT ?? join(root, "stations", "ask-help", "evals"),
    `run-${new Date().toISOString().slice(0, 10)}.json`,
  ),
  `${JSON.stringify({ at: new Date().toISOString(), results, loop: two.loop, held_out: two.held_out }, null, 2)}\n`,
);
