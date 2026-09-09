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
}
interface Chain {
  id: string;
  title: string;
  shape: string;
  turns: Turn[];
  corrections: number;
}
interface Shape {
  id: string;
  question: string;
  rebased: { status: string; gold?: string };
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

/** One turn of a conversation through the headless door; the settled document, or null with the terminal reason. */
async function turn(
  conversation: string,
  message: string,
): Promise<{ document: number | null; terminal: string; seconds: number }> {
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
  return {
    document: verdict.result?.document ?? null,
    terminal,
    seconds: Math.round((Date.now() - started) / 1000),
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

for (const c of chains) {
  const shape = shapes.find((s) => s.id === c.shape);
  const want = shape?.rebased.gold ? expect[shape.rebased.gold] : undefined;
  if (!want?.content_hash) {
    console.log(`${c.id}: skipped, ${c.shape} has no gold`);
    (out.chains as unknown[]).push({ id: c.id, skipped: `${c.shape} has no gold` });
    continue;
  }
  const conversation = `chain-${c.id}-${Date.now().toString(36)}`;
  const sent: {
    kind: string;
    text: string;
    document: number | null;
    terminal: string;
    seconds: number;
    matched: boolean;
  }[] = [];
  let matched = false;
  let last: number | null = null;
  const check = async (document: number | null): Promise<boolean> => {
    if (document === null) return false;
    const r = await run(document);
    return r.content_hash === want.content_hash;
  };
  // the opening and the additions, in order
  for (const t of c.turns.filter((t) => t.kind === "opening" || t.kind === "addition")) {
    const r = await turn(conversation, t.text);
    last = r.document ?? last;
    matched = await check(r.document);
    sent.push({ kind: t.kind, text: t.text, ...r, matched });
    console.log(
      `${c.id} ${t.kind}: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}`} [${r.seconds} s]`,
    );
  }
  // the researcher's corrections, held back, one at a time until the gold is reached
  let corrections = 0;
  if (!matched) {
    for (const t of c.turns.filter((t) => t.kind === "correction")) {
      corrections++;
      const r = await turn(conversation, t.text);
      last = r.document ?? last;
      matched = await check(r.document);
      sent.push({ kind: t.kind, text: t.text, ...r, matched });
      console.log(
        `${c.id} correction ${corrections}: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}`} [${r.seconds} s]${matched ? " reached" : ""}`,
      );
      if (matched) break;
    }
  }
  const final = last === null ? null : await run(last);
  console.log(
    `${c.id}: ${matched ? `reached with ${corrections} correction${corrections === 1 ? "" : "s"}` : "not reached"} (the researcher gave ${c.corrections}); last document ${last ?? "none"}${final ? `, ${final.row_count} rows` : ""}, the gold has ${want.row_count}`,
  );
  (out.chains as unknown[]).push({
    id: c.id,
    shape: c.shape,
    reached: matched,
    corrections_needed: matched ? corrections : null,
    corrections_given: c.corrections,
    turns: sent,
    last,
    final,
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
  }[] = [];
  for (let i = 0; i < times; i++) {
    const r = await turn(`stable-${stableId}-${i}-${Date.now().toString(36)}`, stableShape.question);
    const ran = r.document === null ? null : await run(r.document);
    runs.push({
      document: r.document,
      terminal: r.terminal,
      content_hash: ran?.content_hash ?? null,
      row_count: ran?.row_count ?? -1,
      digest: ran?.digest ?? null,
      seconds: r.seconds,
    });
    console.log(
      `${stableId} run ${i + 1}: ${r.document === null ? `no document (${r.terminal})` : `document ${r.document}, ${ran?.row_count} rows, digest ${ran?.digest ?? "none"}`} [${r.seconds} s]`,
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
  join(root, "stations", "ask-help", "evals", `chains-${new Date().toISOString().slice(0, 10)}.json`),
  `${JSON.stringify(out, null, 2)}\n`,
);
