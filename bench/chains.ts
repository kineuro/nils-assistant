// SPDX-License-Identifier: AGPL-3.0-only
// The chains and the stability check of ask-help (Wave 4c §9.11, D4).
//
// A chain is one standing selection edited over and over, turn by turn,
// through one conversation of the station; a follow-up turn re-enters the
// station on the settled document (§7.7). The researcher's own corrections
// are held back: the opening and the additions are sent in order, the
// document after the last one is run by the engine and its content hash
// compared to the chain's gold. When it misses, the held-back corrections
// are sent one at a time, in their order, until it matches; the count sent
// is what the station needed against what the researcher gave. A chain the
// corrections do not rescue is not reached.
//
// The stability check runs one shape several times, each in a fresh
// conversation, and asks that every run come to one number and the same
// session scheme digest (§11, D4).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const host = (process.env.ASSISTANT_URL ?? "http://127.0.0.1:7300").replace(/\/+$/u, "");
const nils = (process.env.NILS_URL ?? "http://127.0.0.1:8437").replace(/\/+$/u, "");
const token = process.env.NILS_TOKEN ?? "the-persons-token";
const only = process.env.ONLY?.split(",").filter(Boolean);
const stability = process.env.STABILITY ?? "shape-23:5";
const root = process.cwd();

interface Turn {
  kind: "opening" | "correction" | "addition" | "meta" | "verification";
  text: string;
  /** An authored chain carries a gold for the turn: the document the turn should leave. */
  gold?: string;
}
interface Chain {
  id: string;
  title: string;
  /** The shape whose gold the opening is scored against; an authored chain names none and carries a gold per turn. */
  shape?: string;
  turns: Turn[];
  corrections: number;
}
interface Shape {
  id: string;
  question: string;
  rebased: { status: string; gold?: string; question?: string };
}

const chains = (
  parse(readFileSync(join(root, "bench", "corpus", "chains.yml"), "utf8")) as { chains: Chain[] }
).chains.filter((c) => !only || only.includes(c.id));
const shapes = (
  parse(readFileSync(join(root, "bench", "corpus", "shapes.yml"), "utf8")) as { shapes: Shape[] }
).shapes;
const expect = JSON.parse(readFileSync(join(root, "bench", "gold", "expect.json"), "utf8")) as Record<
  string,
  { content_hash: string | null; row_count: number }
>;

async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(url, init);
  return (await r.json()) as Record<string, unknown>;
}

/** The tool calls a conversation has made so far, from its history: the count and the refused ones. */
async function calls(conversation: string): Promise<{ tool_calls: number; refused: number }> {
  const h = (await json(`${host}/agents/ask-help/${conversation}?view=history`).catch(() => null)) as {
    messages?: { role?: string; parts?: { type?: string; output?: unknown }[] }[];
  } | null;
  let tool_calls = 0;
  let refused = 0;
  for (const m of h?.messages ?? []) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts ?? []) {
      if (p.type !== "dynamic-tool") continue;
      tool_calls++;
      if ((p.output as { refused?: boolean } | undefined)?.refused === true) refused++;
    }
  }
  return { tool_calls, refused };
}

/** One turn of a conversation through the headless door; the settled document, or null with the terminal reason, and the calls the turn took. */
async function turn(
  conversation: string,
  message: string,
): Promise<{
  document: number | null;
  terminal: string;
  seconds: number;
  tool_calls: number;
  refused: number;
}> {
  const before = await calls(conversation);
  const started = Date.now();
  const run = await json(`${host}/stations/ask-help/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, conversation }),
  });
  if (run.error) throw new Error(`the host refused the turn: ${String(run.error)}`);
  let state: Record<string, unknown> = run;
  for (let i = 0; i < 120 && !["settled", "failed", "aborted"].includes(String(state.state)); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    state = await json(`${host}/runs/${run.run}`);
  }
  const reply = state.reply as { metadata?: { terminal?: string } } | null;
  const terminal = reply?.metadata?.terminal ?? (state.state === "settled" ? "settled" : String(state.state));
  const verdict = (await json(`${host}/runs/${run.run}/verdict`).catch(() => ({}))) as {
    result?: { document?: number };
  };
  const after = await calls(conversation);
  return {
    document: verdict.result?.document ?? null,
    terminal,
    seconds: Math.round((Date.now() - started) / 1000),
    tool_calls: after.tool_calls - before.tool_calls,
    refused: after.refused - before.refused,
  };
}

/** The engine runs the document: its content hash, row count and declaration. */
async function run(
  document: number,
): Promise<{ content_hash: string | null; row_count: number; digest: string | null; error: string | null }> {
  const ran = await json(`${nils}/api/ask/run`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ document_id: document }),
  });
  const decl = ran.declaration as { session_scheme?: { digest?: string } } | undefined;
  return {
    content_hash: typeof ran.content_hash === "string" ? ran.content_hash : null,
    row_count: typeof ran.row_count === "number" ? ran.row_count : -1,
    digest: decl?.session_scheme?.digest ?? null,
    error: ran.error ? String(ran.error).slice(0, 120) : null,
  };
}

const out: Record<string, unknown> = { at: new Date().toISOString(), host, chains: [], stability: null };

/** A gold file drafted and stored now: its document, so the answers compare. */
async function storeGold(file: string): Promise<number | null> {
  const stored = await json(`${nils}/api/ask/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: readFileSync(join(root, "bench", "gold", file), "utf8") }),
  });
  return typeof stored.document === "number" ? stored.document : null;
}

/** The turn's document reached the gold: the same content hash, else the same answer. */
async function reached(
  document: number | null,
  goldFile: string,
  goldDocument: number | null,
): Promise<boolean> {
  if (document === null || goldDocument === null) return false;
  const want = expect[goldFile];
  const r = await run(document);
  if (want?.content_hash && r.content_hash === want.content_hash) return true;
  return same(document, goldDocument).catch(() => false);
}

/** The same answer as the gold: the set of subject codes when both carry one, else the one row of a count. */
async function same(document: number, goldDocument: number): Promise<boolean> {
  const codes = async (id: number): Promise<{ codes: string[] | null; first: string; n: number }> => {
    const r = await json(`${nils}/api/ask/run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ document_id: id }),
    });
    const cols = ((r.columns as (string | { name: string })[] | undefined) ?? []).map((c) =>
      typeof c === "string" ? c : c.name,
    );
    const k = cols.findIndex((c) => c === "code" || c.endsWith(".code"));
    const rows = (r.rows as unknown[][] | undefined) ?? [];
    // the values of the first row without the technical columns, sorted: a count answered as rows and subjects, or as two named aggregates, is the same answer
    const keep = cols.map((c) => !c.startsWith("_"));
    const first = (rows[0] ?? [])
      .filter((_, i) => keep[i])
      .map((v) => JSON.stringify(v))
      .sort();
    return {
      codes: k < 0 ? null : [...new Set(rows.map((row) => String(row[k])))].sort(),
      first: JSON.stringify(first),
      n: typeof r.row_count === "number" ? r.row_count : -1,
    };
  };
  const [a, b] = await Promise.all([codes(document), codes(goldDocument)]);
  if (a.codes && b.codes)
    return a.codes.length === b.codes.length && a.codes.every((v, i) => v === b.codes?.[i]);
  return a.n === b.n && (a.n !== 1 || a.first === b.first);
}

for (const c of chains.filter((c) => c.turns.some((t) => t.gold))) {
  const conversation = `chain-${c.id}-${Date.now().toString(36)}`;
  const sent: {
    kind: string;
    text: string;
    document: number | null;
    terminal: string;
    seconds: number;
    tool_calls: number;
    refused: number;
    matched: boolean;
  }[] = [];
  let hit = 0;
  let scored = 0;
  for (const t of c.turns) {
    const r = await turn(conversation, t.text);
    let matched = false;
    if (t.gold) {
      scored++;
      matched = await reached(r.document, t.gold, await storeGold(t.gold));
      if (matched) hit++;
    }
    sent.push({ kind: t.kind, text: t.text, ...r, matched });
    console.log(
      `${c.id} ${t.kind}: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}`} [${r.seconds} s, ${r.tool_calls} calls]${t.gold ? (matched ? " reached" : " missed") : ""}`,
    );
  }
  console.log(`${c.id}: ${hit} of ${scored} turns reached their gold`);
  (out.chains as unknown[]).push({
    id: c.id,
    authored: true,
    turns_reached: hit,
    turns_scored: scored,
    turns: sent,
  });
}

for (const c of chains.filter((c) => !c.turns.some((t) => t.gold))) {
  const shape = shapes.find((s) => s.id === c.shape);
  const want = shape?.rebased.gold ? expect[shape.rebased.gold] : undefined;
  if (!want?.content_hash || !shape?.rebased.gold) {
    console.log(`${c.id}: skipped, ${c.shape} has no gold`);
    (out.chains as unknown[]).push({ id: c.id, skipped: `${c.shape} has no gold` });
    continue;
  }
  // the gold of the opening question, stored so the answers compare
  const goldText = readFileSync(join(root, "bench", "gold", shape.rebased.gold), "utf8");
  const stored = await json(`${nils}/api/ask/draft`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: goldText }),
  });
  const goldDocument = typeof stored.document === "number" ? stored.document : null;
  const conversation = `chain-${c.id}-${Date.now().toString(36)}`;
  const sent: {
    kind: string;
    text: string;
    document: number | null;
    terminal: string;
    seconds: number;
    tool_calls: number;
    refused: number;
    matched: boolean;
  }[] = [];
  const check = async (document: number | null): Promise<boolean> => {
    if (document === null || goldDocument === null) return false;
    const r = await run(document);
    if (r.content_hash === want.content_hash) return true;
    return same(document, goldDocument).catch(() => false);
  };
  // the opening, then the researcher's corrections held back one at a time until the gold's answer is reached
  const opening = c.turns.find((t) => t.kind === "opening");
  let matched = false;
  let corrections = 0;
  if (opening) {
    const r = await turn(conversation, opening.text);
    matched = await check(r.document);
    sent.push({ kind: "opening", text: opening.text, ...r, matched });
    console.log(
      `${c.id} opening: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}`} [${r.seconds} s, ${r.tool_calls} calls]${matched ? " reached" : ""}`,
    );
    if (!matched) {
      for (const t of c.turns.filter((t) => t.kind === "correction")) {
        corrections++;
        const r2 = await turn(conversation, t.text);
        matched = await check(r2.document);
        sent.push({ kind: t.kind, text: t.text, ...r2, matched });
        console.log(
          `${c.id} correction ${corrections}: ${r2.document === null ? `no document (${r2.terminal})` : `document ${r2.document}`} [${r2.seconds} s, ${r2.tool_calls} calls]${matched ? " reached" : ""}`,
        );
        if (matched) break;
      }
    }
  }
  // the additions as follow-up turns: the chain holds when every turn leaves a document
  let held = 0;
  const additions = c.turns.filter((t) => t.kind === "addition");
  for (const t of additions) {
    const r = await turn(conversation, t.text);
    if (r.document !== null) held++;
    sent.push({ kind: t.kind, text: t.text, ...r, matched: false });
    console.log(
      `${c.id} addition: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}`} [${r.seconds} s, ${r.tool_calls} calls]`,
    );
  }
  console.log(
    `${c.id}: the opening ${matched ? `reached the gold's answer with ${corrections} correction${corrections === 1 ? "" : "s"}` : `did not reach the gold's answer after ${corrections} corrections`} (the researcher gave ${c.corrections}); ${held} of ${additions.length} follow-up turns left a document`,
  );
  (out.chains as unknown[]).push({
    id: c.id,
    shape: c.shape,
    reached: matched,
    corrections_needed: matched ? corrections : null,
    corrections_given: c.corrections,
    follow_ups_with_a_document: held,
    follow_ups: additions.length,
    turns: sent,
  });
}

// the stability check: one shape, several fresh conversations, one number and one digest
const [stableId, timesText] = stability.split(":");
const times = Number(timesText ?? "5");
const stableShape = shapes.find((s) => s.id === stableId);
if (stableShape?.rebased.gold && expect[stableShape.rebased.gold]?.content_hash) {
  const runs: {
    document: number | null;
    terminal: string;
    content_hash: string | null;
    row_count: number;
    digest: string | null;
    seconds: number;
    tool_calls: number;
  }[] = [];
  for (let i = 0; i < times; i++) {
    const r = await turn(
      `stable-${stableId}-${i}-${Date.now().toString(36)}`,
      stableShape.rebased.question ?? stableShape.question,
    );
    const ran = r.document === null ? null : await run(r.document);
    runs.push({
      document: r.document,
      terminal: r.terminal,
      content_hash: ran?.content_hash ?? null,
      row_count: ran?.row_count ?? -1,
      digest: ran?.digest ?? null,
      seconds: r.seconds,
      tool_calls: r.tool_calls,
    });
    console.log(
      `${stableId} run ${i + 1}: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}, ${ran?.row_count} rows, digest ${ran?.digest ?? "none"}`} [${r.seconds} s, ${r.tool_calls} calls]`,
    );
  }
  const hashes = new Set(runs.map((r) => r.content_hash).filter(Boolean));
  const digests = new Set(runs.map((r) => r.digest).filter(Boolean));
  const gold = expect[stableShape.rebased.gold].content_hash;
  const oneNumber = runs.every((r) => r.row_count === 1) && hashes.size === 1;
  console.log(
    `${stableId} stability: ${runs.filter((r) => r.content_hash === gold).length} of ${times} match the gold; ${hashes.size} distinct answer${hashes.size === 1 ? "" : "s"}, ${digests.size} distinct scheme digest${digests.size === 1 ? "" : "s"}; ${oneNumber && digests.size === 1 ? "one number, one digest" : "not stable"}`,
  );
  out.stability = {
    shape: stableId,
    times,
    runs,
    matched_gold: runs.filter((r) => r.content_hash === gold).length,
    distinct_answers: hashes.size,
    distinct_digests: digests.size,
    stable: oneNumber && digests.size === 1,
  };
}

writeFileSync(
  join(
    process.env.EVALS_OUT ?? join(root, "stations", "ask-help", "evals"),
    `chains-${new Date().toISOString().slice(0, 10)}.json`,
  ),
  `${JSON.stringify(out, null, 2)}\n`,
);
