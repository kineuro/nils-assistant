// SPDX-License-Identifier: AGPL-3.0-only
// The evals of ask-help (Wave 4c §9.11, D4, refined 2026-09-09): the shapes
// of a corpus through the station, headless, against a running host; the
// verdict's document is run by the engine and compared to the gold, first by
// content hash, then by the answer itself (the same subjects, or the same
// rows without the technical columns). Both splits are reported. Beside the
// answer, each run's trace is read from the conversation's history: how many
// turns and tool calls it took, how many calls were refused, how many drafts
// were written and how many of those the engine refused. A station that is
// right in twelve calls is not the station that is right in two.
//
// CORPUS names which corpus runs: `shapes` (the paraphrased corpus of §9.10),
// `authored` (the questions written for NILS v1), or `all` (the default).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { report } from "./manifest/split.ts";

const host = (process.env.ASSISTANT_URL ?? "http://127.0.0.1:7300").replace(/\/+$/u, "");
const nils = (process.env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, "");
const token = process.env.NILS_TOKEN ?? "the-persons-token";
const only = process.env.ONLY?.split(",").filter(Boolean);
const corpus = process.env.CORPUS ?? "all";
const root = process.cwd();

interface Shape {
  id: string;
  corpus: string;
  question: string;
  gold: string;
}

/** The shapes of the corpora asked for, each with the file of its gold. */
function corpora(): Shape[] {
  const out: Shape[] = [];
  if (corpus === "shapes" || corpus === "all") {
    const raw = parse(readFileSync(join(root, "bench", "corpus", "shapes.yml"), "utf8")) as {
      shapes: { id: string; question: string; rebased: { gold?: string; question?: string } }[];
    };
    for (const s of raw.shapes)
      if (s.rebased.gold)
        out.push({
          id: s.id,
          corpus: "shapes",
          question: s.rebased.question ?? s.question,
          gold: s.rebased.gold,
        });
  }
  if (corpus === "authored" || corpus === "all") {
    const raw = parse(readFileSync(join(root, "bench", "corpus", "authored.yml"), "utf8")) as {
      shapes: { id: string; question: string; gold: string }[];
    };
    for (const s of raw.shapes)
      out.push({ id: s.id, corpus: "authored", question: s.question, gold: s.gold });
  }
  return out.filter((s) => !only || only.includes(s.id));
}

const shapes = corpora();
const expect = JSON.parse(readFileSync(join(root, "bench", "gold", "expect.json"), "utf8")) as Record<
  string,
  { content_hash: string | null; row_count: number }
>;

async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(url, init);
  return (await r.json()) as Record<string, unknown>;
}

const auth = { authorization: `Bearer ${token}` };

/** Every row of a handle, the technical columns dropped, as sorted JSON lines; and the code column when there is one. */
async function rowsOf(handle: number): Promise<{ rows: string[]; codes: string[] | null }> {
  const rows: string[] = [];
  const codes: string[] = [];
  let hasCode = false;
  // the rows door pages from zero
  for (let page = 0; page < 200; page++) {
    const r = await json(`${nils}/api/ask/handles/${handle}/rows?page=${page}`, { headers: auth });
    const cols = ((r.columns as (string | { name: string })[] | undefined) ?? []).map((c) =>
      typeof c === "string" ? c : c.name,
    );
    // the subject's code however the document reached it: `code` at the subject grain, `subject.code` from below
    const k = cols.findIndex((c) => c === "code" || c.endsWith(".code"));
    hasCode = k >= 0;
    const keep = cols.map((c) => !c.startsWith("_"));
    for (const row of (r.rows as unknown[][] | undefined) ?? []) {
      rows.push(JSON.stringify(row.filter((_, i) => keep[i])));
      if (k >= 0) codes.push(String(row[k]));
    }
    if (typeof r.pages !== "number" || page + 1 >= r.pages) break;
  }
  // the set of subjects, not the multiset of rows: a document that lists a subject twice still selected the same people
  return { rows: rows.sort(), codes: hasCode ? [...new Set(codes)].sort() : null };
}

/** The gold, drafted and run now, so its handle can be read beside ours. */
async function goldHandle(goldFile: string): Promise<number | null> {
  const goldText = readFileSync(join(root, "bench", "gold", goldFile), "utf8");
  const stored = await json(`${nils}/api/ask/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ text: goldText }),
  });
  if (typeof stored.document !== "number") return null;
  const ran = await json(`${nils}/api/ask/run`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify({ document_id: stored.document }),
  });
  return typeof ran.handle === "number" ? ran.handle : null;
}

/**
 * The looser measure beside the hash: the same answer. When both sides carry
 * a subject code, the same set of subjects however the columns were chosen;
 * otherwise the same rows once the technical columns are dropped, in any
 * order (a count answered as rows and subjects, a table with the same cells).
 */
async function sameAnswer(handle: number, goldFile: string): Promise<boolean | null> {
  const g = await goldHandle(goldFile);
  if (g === null) return null;
  const [a, b] = await Promise.all([rowsOf(handle), rowsOf(g)]);
  if (a.codes && b.codes)
    return a.codes.length === b.codes.length && a.codes.every((v, i) => v === b.codes?.[i]);
  return a.rows.length === b.rows.length && a.rows.every((v, i) => v === b.rows[i]);
}

export interface Trace {
  /** Assistant messages: one per model turn. */
  turns: number;
  /** Tool calls the model made, the refused ones included. */
  tool_calls: number;
  /** Calls the station refused (a phase, a loop, a budget, a check). */
  refused: number;
  /** Drafts sent to the engine (nils_draft and nils_store). */
  drafts: number;
  /** Drafts the engine refused. */
  draft_refusals: number;
  /** Settle attempts. */
  settles: number;
  /** The tools called, in order. */
  tools: string[];
}

/** The trace of one conversation from its history: what the model did to get there. */
async function trace(station: string, conversation: string): Promise<Trace | null> {
  const h = (await json(`${host}/agents/${station}/${conversation}?view=history`).catch(() => null)) as {
    messages?: { role?: string; parts?: { type?: string; toolName?: string; output?: unknown }[] }[];
  } | null;
  if (!h?.messages) return null;
  const t: Trace = {
    turns: 0,
    tool_calls: 0,
    refused: 0,
    drafts: 0,
    draft_refusals: 0,
    settles: 0,
    tools: [],
  };
  for (const m of h.messages) {
    if (m.role !== "assistant") continue;
    t.turns++;
    for (const p of m.parts ?? []) {
      if (p.type !== "dynamic-tool" || !p.toolName) continue;
      t.tool_calls++;
      t.tools.push(p.toolName);
      const out = (p.output ?? {}) as { refused?: boolean; document?: unknown; settled?: boolean };
      if (out.refused === true) t.refused++;
      if (p.toolName === "nils_draft" || p.toolName === "nils_store") {
        t.drafts++;
        if (typeof out.document !== "number") t.draft_refusals++;
      }
      if (p.toolName === "settle") t.settles++;
    }
  }
  return t;
}

const results: {
  id: string;
  corpus: string;
  passed: boolean;
  /** The same answer as the gold when the hash differs; null when it could not be measured. */
  selection: boolean | null;
  why: string;
  document: number | null;
  seconds: number;
  terminal: string | null;
  conversation: string;
  trace: Trace | null;
}[] = [];
for (const s of shapes) {
  const started = Date.now();
  const conversation = `eval-${s.id}-${Date.now().toString(36)}`;
  const run = await json(`${host}/stations/ask-help/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
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
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ document_id: document }),
    });
    const want = expect[s.gold];
    if (ran.error) why = `the engine refused document ${document}: ${String(ran.error).slice(0, 100)}`;
    else if (want?.content_hash && ran.content_hash === want.content_hash) {
      passed = true;
      selection = true;
    } else {
      selection =
        typeof ran.handle === "number" ? await sameAnswer(ran.handle, s.gold).catch(() => null) : false;
      why = `document ${document}: ${ran.row_count} rows, the gold has ${want?.row_count}${selection ? ", the same answer" : ""}; ${verdict.result?.sentence?.slice(0, 100) ?? ""}`;
    }
  }
  const t = await trace("ask-help", conversation);
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({
    id: s.id,
    corpus: s.corpus,
    passed,
    selection,
    why,
    document,
    seconds,
    terminal,
    conversation,
    trace: t,
  });
  console.log(
    `${s.id}: ${passed ? "pass" : selection ? "same answer" : `FAIL (${why})`} [${terminal}, ${seconds} s${t ? `, ${t.turns} turns, ${t.tool_calls} calls, ${t.refused} refused, ${t.drafts} drafts` : ""}]`,
  );
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
};
const summary: Record<string, unknown> = {};
for (const c of [...new Set(results.map((r) => r.corpus))]) {
  const rs = results.filter((r) => r.corpus === c);
  const two = report((id) => rs.find((r) => r.id === id)?.passed ?? false, rs);
  const same = report((id) => rs.find((r) => r.id === id)?.selection === true, rs);
  const traced = rs.filter((r) => r.trace).map((r) => r.trace as Trace);
  const line = {
    of: rs.length,
    strict: rs.filter((r) => r.passed).length,
    same_answer: rs.filter((r) => r.selection === true).length,
    loop: { strict: two.loop, same_answer: same.loop },
    held_out: { strict: two.held_out, same_answer: same.held_out },
    median_seconds: median(rs.map((r) => r.seconds)),
    median_turns: median(traced.map((t) => t.turns)),
    median_tool_calls: median(traced.map((t) => t.tool_calls)),
    refused_calls: traced.reduce((n, t) => n + t.refused, 0),
    drafts: traced.reduce((n, t) => n + t.drafts, 0),
    draft_refusals: traced.reduce((n, t) => n + t.draft_refusals, 0),
    by_budget: rs.filter((r) => r.terminal?.startsWith("budget")).length,
  };
  summary[c] = line;
  console.log(
    `ask-help on ${c}: strict ${line.strict} of ${line.of}, the same answer ${line.same_answer} of ${line.of} (loop ${same.loop.passed}/${same.loop.of}, held out ${same.held_out.passed}/${same.held_out.of}); median ${line.median_seconds} s, ${line.median_turns} turns, ${line.median_tool_calls} calls; ${line.refused_calls} refused calls, ${line.draft_refusals} of ${line.drafts} drafts refused, ${line.by_budget} ended by budget`,
  );
}
writeFileSync(
  join(
    process.env.EVALS_OUT ?? join(root, "stations", "ask-help", "evals"),
    `run-${new Date().toISOString().slice(0, 10)}-${corpus}.json`,
  ),
  `${JSON.stringify({ at: new Date().toISOString(), corpus, summary, results }, null, 2)}\n`,
);
