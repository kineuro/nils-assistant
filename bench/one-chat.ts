// SPDX-License-Identifier: AGPL-3.0-only
// The one-chat bench (Wave 7a, slice C3): the conversations of
// bench/corpus/one-chat.yml through the one agent, `nils`, over the
// assistant host's HTTP API, each run k times in a fresh conversation, and
// graded on outcomes by bench/one-chat-grade.ts. The interface it drives is
// bench/ONE-CHAT.md: a turn is posted as Flue's message admission and read
// back from the conversation's update stream until its submission settles;
// the ledger, the plans its proposals name and the engine's answer to its
// document are read beside it.
//
// One run measures one registry and one find arm. The arm is the host's
// (ONE_CHAT_FIND=skill|subagent, echoed by GET /capabilities as
// one_chat.find); --arm only asserts it. Run once per arm, and the second
// invocation of the day writes the comparison beside both.
//
//   node dist/bench/one-chat.js --model <name> --registry gold|seeded
//     [--assistant <url>] [--engine <url>] [--k 3] [--only id,...] [--kinds k,...]
//     [--arm skill|subagent] [--seeded <home>/seeded.json] [--token <token>]
//     [--person <name>=<token> ...] [--out <dir>] [--allow-remote]
//
// Tokens are used and never written to a result.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { planView } from "./cases.ts";
import { endpoint, slug } from "./measure.ts";
import {
  type Conversation,
  corpusProblems,
  documentIn,
  fromChunks,
  gradeTurn,
  type Kind,
  type KindSummary,
  type LedgerRow,
  type Lexicon,
  planIdsIn,
  type RunGrade,
  summarize,
  type TurnGrade,
  type TurnObs,
  table,
} from "./one-chat-grade.ts";
import { engine } from "./turns.ts";

const root = process.cwd();

export function loadCorpus(dir = join(root, "bench")): {
  conversations: Conversation[];
  lexicon: Lexicon;
  golds: Record<string, { content_hash: string | null }>;
} {
  const conversations = (
    parse(readFileSync(join(dir, "corpus", "one-chat.yml"), "utf8")) as { conversations: Conversation[] }
  ).conversations;
  const lexicon = parse(readFileSync(join(dir, "corpus", "one-chat-lexicon.yml"), "utf8")) as Lexicon;
  const golds = JSON.parse(readFileSync(join(dir, "gold", "expect.json"), "utf8")) as Record<
    string,
    { content_hash: string | null }
  >;
  return { conversations, lexicon, golds };
}

/** The host and the engine as the bench reads them, with one person's token on every call. */
export interface Endpoints {
  assistant: string;
  engine: string;
  token: string;
  /** Milliseconds between reads of a stream that is not yet settled; a long-poll read waits on the host. */
  every?: number;
  /** Seconds a turn may take before it is read as unsettled. */
  turnSeconds?: number;
}

type Rec = Record<string, unknown>;

async function call(
  e: Endpoints,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const r = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${e.token}`, "content-type": "application/json", ...init?.headers },
  });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

/** The agent's id on the host: one agent, one id. */
export const AGENT = "nils";

/** One turn: the message admitted, the stream read until its submission settles, the ledger and plans beside. */
export async function oneTurn(
  e: Endpoints,
  conversation: string,
  message: string,
  ledgerBefore: number,
): Promise<TurnObs & { ledgerAfter: number }> {
  const base = `${e.assistant}/agents/${AGENT}/${encodeURIComponent(conversation)}`;
  const started = Date.now();
  const admitted = await call(e, base, {
    method: "POST",
    body: JSON.stringify({ kind: "user", body: message }),
  });
  if (admitted.status !== 202 && admitted.status !== 200)
    throw new Error(
      `the host refused the turn (${admitted.status}): ${JSON.stringify(admitted.body).slice(0, 200)}`,
    );
  const a = admitted.body as { offset?: string; submissionId?: string };
  let offset = a.offset ?? "-1";
  const chunks: Rec[] = [];
  const bound = started + (e.turnSeconds ?? 600) * 1000;
  let settled = false;
  while (!settled && Date.now() < bound) {
    const r = await fetch(`${base}?view=updates&offset=${encodeURIComponent(offset)}&live=long-poll`, {
      headers: { authorization: `Bearer ${e.token}` },
    });
    const next = r.headers.get("stream-next-offset");
    const body = (await r.json().catch(() => [])) as Rec[];
    if (Array.isArray(body)) chunks.push(...body);
    if (next) offset = next;
    settled = chunks.some(
      (c) => c.type === "submission-settled" && (!a.submissionId || c.submissionId === a.submissionId),
    );
    if (!settled && (!Array.isArray(body) || body.length === 0))
      await new Promise((res) => setTimeout(res, e.every ?? 1000));
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const events = fromChunks(chunks, a.submissionId);
  // the host answers its ledger newest first; the grader reads it in the order it was written
  const ledger = (
    (((await call(e, `${e.assistant}/ledger/${encodeURIComponent(conversation)}`)).body as Rec | null)
      ?.rows ?? []) as LedgerRow[]
  )
    .slice()
    .reverse();
  const plans: Record<string, unknown> = {};
  for (const id of planIdsIn(events)) {
    const p = await call(e, `${e.assistant}/plans/${encodeURIComponent(id)}`);
    if (p.status === 200) plans[id] = { ...(p.body as Rec), ...planView(p.body) };
  }
  return { events, ledger, ledgerBefore, seconds, plans, ledgerAfter: ledger.length };
}

/** What a run of the bench needs besides the endpoints. */
export interface RunContext {
  lexicon: Lexicon;
  golds: Record<string, { content_hash: string | null }>;
  arm: "skill" | "subagent";
  /** Tokens by person; `default` is the run's own. */
  tokens: Record<string, string>;
  /** The planted runs by case, from seeded.json. */
  runs: Record<string, number>;
  /** The gold texts, read from bench/gold/. */
  goldText: (file: string) => string;
}

/** A message with what the seed made named by name. */
export async function resolveMessage(text: string, e: Endpoints, ctx: RunContext): Promise<string> {
  let out = text;
  for (const m of text.matchAll(/\{(run|batch|document):([^}]+)\}/gu)) {
    let id: number | null = null;
    if (m[1] === "run") id = ctx.runs[m[2]] ?? null;
    else {
      const r = await call(e, m[1] === "batch" ? `${e.engine}/api/batches` : `${e.engine}/api/ask/documents`);
      const body = r.body as Rec | Rec[] | null;
      const list = (
        Array.isArray(body) ? body : m[1] === "batch" ? (body?.batches ?? body) : body?.documents
      ) as Rec[] | undefined;
      const found = (Array.isArray(list) ? list : []).find((x) => x.name === m[2]);
      const v = found?.[m[1] === "batch" ? "id" : "document"];
      id = typeof v === "number" ? v : null;
    }
    if (id === null)
      throw new Error(`no ${m[1]} named ${m[2]}; was the registry seeded, and seeded.json given?`);
    out = out.replace(m[0], String(id));
  }
  return out;
}

/** One run of one conversation, in a fresh conversation, every turn graded. */
export async function runConversation(
  c: Conversation,
  run: number,
  base: Endpoints,
  ctx: RunContext,
): Promise<RunGrade> {
  const token = ctx.tokens[c.person ?? "default"];
  if (!token)
    return {
      conversation: c.id,
      kind: c.kind,
      run,
      passed: false,
      turns: [],
      skipped: `no token for the person ${c.person}`,
    };
  const e: Endpoints = { ...base, token };
  const doors = engine(e.engine, ctx.tokens.default ?? token);
  const conversation = `oc-${c.id}-r${run}-${Date.now().toString(36)}`;
  const turns: TurnGrade[] = [];
  let ledgerBefore = 0;
  for (const t of c.turns) {
    const obs = await oneTurn(e, conversation, await resolveMessage(t.say, e, ctx), ledgerBefore);
    ledgerBefore = obs.ledgerAfter;
    const gold = t.expect?.gold;
    const followUps: TurnGrade[] = [];
    if (gold) {
      const goldDocument = await doors.draft(ctx.goldText(gold));
      let document = documentIn(obs.events);
      obs.goldReached = await doors.reached(document, ctx.golds[gold], goldDocument);
      obs.corrections = 0;
      // the person's own corrections, one at a time, while the gold is not reached; each is held to the bars
      for (const fix of t.corrections ?? []) {
        if (obs.goldReached) break;
        const f = await oneTurn(e, conversation, fix, ledgerBefore);
        ledgerBefore = f.ledgerAfter;
        obs.corrections++;
        document = documentIn(f.events) ?? document;
        obs.goldReached = await doors.reached(document, ctx.golds[gold], goldDocument);
        followUps.push(gradeTurn({ say: fix }, f, ctx.lexicon, ctx.arm));
      }
    }
    turns.push(gradeTurn(t, obs, ctx.lexicon, ctx.arm), ...followUps);
  }
  return { conversation: c.id, kind: c.kind, run, passed: turns.every((t) => t.passed), turns };
}

export interface BenchResult {
  at: string;
  model: string;
  registry: "gold" | "seeded";
  arm: "skill" | "subagent";
  k: number;
  host: { assistant: string; engine: string };
  summary: KindSummary[];
  runs: RunGrade[];
  unmeasured: { conversation: string; why: string }[];
}

/** Every conversation of the registry run k times, in order, one run after another (one card, one stream). */
export async function bench(
  conversations: Conversation[],
  o: { k: number; model: string; registry: "gold" | "seeded"; endpoints: Endpoints; ctx: RunContext },
  log: (line: string) => void = () => {},
): Promise<BenchResult> {
  const runs: RunGrade[] = [];
  const unmeasured: { conversation: string; why: string }[] = [];
  for (const c of conversations.filter((c) => c.registry === o.registry)) {
    for (let r = 1; r <= o.k; r++) {
      let g: RunGrade;
      try {
        g = await runConversation(c, r, o.endpoints, o.ctx);
      } catch (err) {
        g = {
          conversation: c.id,
          kind: c.kind,
          run: r,
          passed: false,
          turns: [],
          skipped: `the run broke: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      if (g.skipped) {
        if (!unmeasured.some((u) => u.conversation === c.id))
          unmeasured.push({ conversation: c.id, why: g.skipped });
        log(`${c.id} run ${r}: unmeasured, ${g.skipped}`);
        if (g.skipped.startsWith("no token")) break;
        continue;
      }
      runs.push(g);
      log(
        `${c.id} run ${r}: ${
          g.passed
            ? "passed"
            : `missed (${g.turns
                .flatMap((t) => t.misses)
                .slice(0, 3)
                .join("; ")})`
        }`,
      );
    }
  }
  return {
    at: new Date().toISOString(),
    model: o.model,
    registry: o.registry,
    arm: o.ctx.arm,
    k: o.k,
    host: { assistant: o.endpoints.assistant, engine: o.endpoints.engine },
    summary: summarize(runs, o.k),
    runs,
    unmeasured,
  };
}

/** The result as a short page: the arm's table, what was left out. */
export function page(r: BenchResult): string {
  return [
    `# One chat, ${r.registry} registry, find as a ${r.arm === "skill" ? "skill" : "read-only sub-agent"}`,
    "",
    `${r.at.slice(0, 10)}, model ${r.model}, each conversation run ${r.k} times.`,
    "",
    table(r.summary, r.k),
    "",
    ...(r.unmeasured.length
      ? ["Unmeasured:", "", ...r.unmeasured.map((u) => `- ${u.conversation}: ${u.why}`), ""]
      : []),
  ].join("\n");
}

/** The two find arms side by side, for the kinds that find data and the whole run. */
export function compare(skill: BenchResult, subagent: BenchResult): string {
  const pick = (r: BenchResult, kind: KindSummary["kind"]) => r.summary.find((s) => s.kind === kind);
  const pct = (x: number | null | undefined) =>
    x === null || x === undefined ? "" : `${Math.round(x * 100)} %`;
  const kinds: KindSummary["kind"][] = ["find", "refine", "switch", "injection", "all"];
  const lines = kinds.flatMap((kind) => {
    const a = pick(skill, kind);
    const b = pick(subagent, kind);
    if (!a && !b) return [];
    return [
      `| ${kind} | ${pct(a?.pass_at_1)} | ${pct(a?.pass_hat_k)} | ${a?.seconds.median ?? ""} | ${pct(b?.pass_at_1)} | ${pct(b?.pass_hat_k)} | ${b?.seconds.median ?? ""} |`,
    ];
  });
  return [
    `# Finding data: a skill or a read-only sub-agent (${skill.registry} registry, ${skill.model})`,
    "",
    `| kind | skill pass@1 | skill pass^${skill.k} | skill s median | sub-agent pass@1 | sub-agent pass^${subagent.k} | sub-agent s median |`,
    "|---|---|---|---|---|---|---|",
    ...lines,
    "",
    "The skill is the default; the sub-agent wins only if it is measurably better (decision of 2026-10-09).",
    "",
  ].join("\n");
}

function options(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: "string" },
      registry: { type: "string" },
      assistant: { type: "string", default: "http://127.0.0.1:7300" },
      engine: { type: "string", default: "http://127.0.0.1:8437" },
      k: { type: "string", default: "3" },
      only: { type: "string" },
      kinds: { type: "string" },
      arm: { type: "string" },
      seeded: { type: "string" },
      token: { type: "string" },
      person: { type: "string", multiple: true },
      out: { type: "string" },
      "allow-remote": { type: "boolean", default: false },
    },
  });
  if (!values.model) throw new Error("--model names the model the host serves, for the record");
  if (values.registry !== "gold" && values.registry !== "seeded")
    throw new Error("--registry is gold or seeded: the registry the host's engine serves");
  if (values.arm && values.arm !== "skill" && values.arm !== "subagent")
    throw new Error("--arm is skill or subagent");
  const allow = values["allow-remote"] === true;
  const tokens: Record<string, string> = {
    default: values.token ?? process.env.NILS_TOKEN ?? "the-persons-token",
  };
  for (const p of values.person ?? []) {
    const i = p.indexOf("=");
    if (i < 1) throw new Error(`--person ${p.split("=")[0]}: <name>=<token>`);
    tokens[p.slice(0, i)] = p.slice(i + 1);
  }
  const runs: Record<string, number> = {};
  if (values.seeded)
    for (const r of (
      JSON.parse(readFileSync(values.seeded, "utf8")) as { runs?: { case: string; run: number }[] }
    ).runs ?? [])
      runs[r.case] = r.run;
  return {
    model: values.model,
    registry: values.registry as "gold" | "seeded",
    assistant: endpoint(values.assistant ?? "", allow, "--assistant"),
    engine: endpoint(values.engine ?? "", allow, "--engine"),
    k: Math.max(1, Number(values.k ?? "3")),
    only: values.only?.split(",").filter(Boolean) ?? null,
    kinds: (values.kinds?.split(",").filter(Boolean) ?? null) as Kind[] | null,
    arm: (values.arm ?? null) as "skill" | "subagent" | null,
    tokens,
    runs,
    out: resolve(values.out ?? join("bench", "results")),
  };
}

/** The find arm the host serves, from its capabilities. */
export async function armOf(e: Endpoints): Promise<"skill" | "subagent"> {
  const caps = (await call(e, `${e.assistant}/capabilities`)).body as {
    one_chat?: { find?: unknown };
  } | null;
  return caps?.one_chat?.find === "subagent" ? "subagent" : "skill";
}

export async function main(argv: string[]): Promise<void> {
  const o = options(argv);
  const { conversations, lexicon, golds } = loadCorpus();
  const problems = corpusProblems(conversations, lexicon, golds);
  if (problems.length) throw new Error(`the corpus does not hold:\n${problems.join("\n")}`);
  const endpoints: Endpoints = { assistant: o.assistant, engine: o.engine, token: o.tokens.default };
  const arm = await armOf(endpoints);
  if (o.arm && o.arm !== arm)
    throw new Error(`the host serves find as ${arm}, not ${o.arm}: restart it with ONE_CHAT_FIND=${o.arm}`);
  const chosen = conversations.filter(
    (c) => (!o.only || o.only.includes(c.id)) && (!o.kinds || o.kinds.includes(c.kind)),
  );
  const result = await bench(
    chosen,
    {
      k: o.k,
      model: o.model,
      registry: o.registry,
      endpoints,
      ctx: {
        lexicon,
        golds,
        arm,
        tokens: o.tokens,
        runs: o.runs,
        goldText: (f) => readFileSync(join(root, "bench", "gold", f), "utf8"),
      },
    },
    console.log,
  );
  mkdirSync(o.out, { recursive: true });
  const day = result.at.slice(0, 10);
  const name = (arm: string) => `one-chat-${day}-${slug(o.model)}-${o.registry}-${arm}`;
  writeFileSync(join(o.out, `${name(arm)}.json`), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(o.out, `${name(arm)}.md`), page(result));
  console.log(`\n${page(result)}`);
  const other = join(o.out, `${name(arm === "skill" ? "subagent" : "skill")}.json`);
  if (existsSync(other)) {
    const b = JSON.parse(readFileSync(other, "utf8")) as BenchResult;
    const [skill, subagent] = arm === "skill" ? [result, b] : [b, result];
    const both = compare(skill, subagent);
    writeFileSync(join(o.out, `one-chat-${day}-${slug(o.model)}-${o.registry}-arms.md`), both);
    console.log(both);
  }
}

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("bench", "one-chat.js")))
  await main(process.argv.slice(2));
