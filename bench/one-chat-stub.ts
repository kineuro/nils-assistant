// SPDX-License-Identifier: AGPL-3.0-only
// A stand-in for the one agent and its engine, to prove the one-chat bench
// end to end before the agent exists: one HTTP server that speaks the
// interface of bench/ONE-CHAT.md (Flue's message admission and update
// stream under /agents/nils, the ledger, the plans, the capabilities) and
// the few engine doors the bench reads (ask run and draft, batches,
// documents). It measures no model.
//
// By default it is an oracle: each turn does what the corpus expects of it
// (the skill, the tools, a document that reaches the gold, the proposal,
// an answer from bench/one-chat-stub.yml), so a correct bench passes every
// conversation. Faults make it misbehave in the ways the graders must
// catch: a door phrase, an engine word, a step after the answer, a write
// with no approval, a proposal where none belongs, the wrong skill, a run
// that fails only the third time, a document that misses its gold, a
// malformed or refused call.
//
// It knows which conversation and turn a message belongs to from the
// conversation id the bench gives (`oc-<id>-r<run>-<stamp>`) and the turns
// posted so far; a message that is the turn's held-back correction is
// read as one.
//
//   node dist/bench/one-chat-stub.js [--port 7399] [--arm skill|subagent] [--fault <conversation|*>=<fault>,...]

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import type { Matcher } from "./cases.ts";
import type { Conversation, Expect, Lexicon } from "./one-chat-grade.ts";

export const FAULTS = [
  "door",
  "engine",
  "late-step",
  "write",
  "propose",
  "wrong-skill",
  "flaky",
  "miss",
  "miss-until-corrected",
  "malformed",
  "refused",
] as const;
export type Fault = (typeof FAULTS)[number];

/** The planted runs, batches and stored questions the stub's engine names. */
export const STUB_RUNS: Record<string, number> = {
  "planted-synthseg": 12,
  "samseg-both-sides": 13,
  "clean-mriqc": 14,
};
const BATCHES = [
  { id: 31, name: "keyword-bench" },
  { id: 32, name: "notes-bench" },
];
const DOCUMENTS = [{ document: 41, name: "bench mprage count" }];

type Rec = Record<string, unknown>;

export interface StubOptions {
  conversations: Conversation[];
  lexicon: Lexicon;
  golds: Record<string, { content_hash: string | null }>;
  /** The gold texts by file, so a drafted gold gets its hash. */
  goldTexts: Record<string, string>;
  /** The oracle's answers, by `<conversation>#<turn>`, 1-based. */
  answers: Record<string, string>;
  arm: "skill" | "subagent";
  /** Faults by conversation id, or `*` for every conversation. */
  faults?: Record<string, Fault[]>;
}

/** A value that holds a matcher, for the oracle's proposal. */
function satisfy(m: Matcher): unknown {
  if (m === "present") return true;
  if (m === "absent") return null;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    if ("has" in m) return m.has;
    if ("in" in m) return m.in[0];
    if ("length" in m) return Array.from({ length: m.length }, () => ({}));
    if ("match" in m) return m.match;
    if ("not" in m) return null;
  }
  return m;
}

/** Sets a dotted path on an object; `a[].b` with a list sets b on each item of a, made as needed. */
function put(target: Rec, path: string, value: unknown): void {
  const [head, ...rest] = path.split(".");
  if (head.endsWith("[]")) {
    const key = head.slice(0, -2);
    const values = Array.isArray(value) ? value : [value];
    const list = (Array.isArray(target[key]) ? target[key] : []) as Rec[];
    values.forEach((v, i) => {
      list[i] = list[i] ?? {};
      if (rest.length) put(list[i], rest.join("."), v);
    });
    target[key] = list;
    return;
  }
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  const next = (target[head] && typeof target[head] === "object" ? target[head] : {}) as Rec;
  target[head] = next;
  put(next, rest.join("."), value);
}

const offsetOf = (n: number) => `0000000000000000_${String(n).padStart(16, "0")}`;

export function stub(o: StubOptions): Server {
  const streams = new Map<string, Rec[]>();
  const ledgers = new Map<string, Rec[]>();
  const turnsSeen = new Map<string, { turn: number; corrections: number }>();
  const plans = new Map<string, Rec>();
  const documents = new Map<number, string | null>();
  let nextDocument = 500;
  let nextPlan = 1;
  let nextSubmission = 1;

  const faultsOf = (cid: string): Fault[] => [...(o.faults?.["*"] ?? []), ...(o.faults?.[cid] ?? [])];

  /** The chunks of one oracle turn, with the faults of its conversation. */
  const respond = (conversation: string, message: string): { chunks: Rec[]; ledger: Rec[] } => {
    const m = /^oc-(.+)-r(\d+)-[a-z0-9]+$/u.exec(conversation);
    const c = o.conversations.find((x) => x.id === m?.[1]);
    const run = Number(m?.[2] ?? "1");
    const seen = turnsSeen.get(conversation) ?? { turn: 0, corrections: 0 };
    // a correction of the turn in hand, or the next turn
    const current = c?.turns[seen.turn - 1];
    const isCorrection = !!current?.corrections?.includes(message);
    if (isCorrection) seen.corrections++;
    else seen.turn++;
    turnsSeen.set(conversation, seen);
    const turn = c?.turns[seen.turn - 1];
    const e: Expect = turn?.expect ?? {};
    const faults = c ? faultsOf(c.id) : [];
    const has = (f: Fault) =>
      faults.includes(f) || (f === "wrong-skill" && faults.includes("flaky") && run === 3);

    const chunks: Rec[] = [];
    const ledger: Rec[] = [];
    let call = 0;
    const tool = (name: string, input: unknown, output: unknown, error?: string) => {
      const id = `call-${++call}`;
      chunks.push({
        type: "tool-input",
        conversationId: conversation,
        messageId: "m",
        toolCallId: id,
        toolName: name,
        input,
      });
      chunks.push(
        error
          ? { type: "tool-output-error", conversationId: conversation, toolCallId: id, errorText: error }
          : { type: "tool-output", conversationId: conversation, toolCallId: id, output },
      );
      if (!o.lexicon.framework_tools.includes(name))
        ledger.push({
          at: Date.now(),
          phase: "turn",
          operation: "catalog",
          method: "GET",
          granted: true,
          outcome: "ok",
        });
    };
    chunks.push({ type: "message-started", conversationId: conversation, messageId: "m" });

    if (!isCorrection && e.skill && o.lexicon.skills.includes(e.skill)) {
      const skill = has("wrong-skill") ? (e.skill === "plan-work" ? "find-data" : "plan-work") : e.skill;
      if (skill === o.lexicon.find.skill && o.arm === "subagent")
        tool(
          "task",
          { agent: o.lexicon.find.subagent, prompt: message },
          { content: [{ type: "text", text: "found" }] },
        );
      else tool("activate_skill", { name: skill }, { content: [], details: { skill } });
    }
    if (e.tools?.only?.length) tool(e.tools.only[0], {}, { content: [], details: {} });
    for (const n of e.tools?.some ?? []) tool(n, {}, { content: [], details: {} });
    if (has("malformed"))
      tool("registry_search", { filter: 3 }, null, "validation failed: must have required property 'text'");
    if (has("refused"))
      tool("registry_describe", { what: "identity" }, { content: [], details: { refused: true } });
    if (e.gold) {
      const right = o.golds[e.gold]?.content_hash ?? null;
      const wrong = has("miss") || (has("miss-until-corrected") && !isCorrection);
      const id = nextDocument++;
      documents.set(id, wrong ? `${right}-not` : right);
      tool("query_draft", { question: message }, { content: [], details: { document: id } });
    }
    if (!isCorrection && e.proposal && typeof e.proposal === "object") {
      const p: Rec = { kind: e.proposal.kind ?? "change" };
      const plan: Rec = {};
      for (const [path, mm] of Object.entries(e.proposal.match ?? {}))
        if (path.startsWith("plan.")) put(plan, path.slice(5), satisfy(mm));
        else put(p, path, satisfy(mm));
      const details: Rec = { ...p, pending: true };
      if (Object.keys(plan).length) {
        const id = `plan-${nextPlan++}`;
        const steps = ((plan.steps as Rec[] | undefined) ?? []).map((s, n) => ({ ...s, n: n + 1, rung: 2 }));
        const proposals = ((plan.proposals as Rec[] | undefined) ?? []).map((s, n) => ({
          ...s,
          n: steps.length + n + 1,
          rung: 3,
        }));
        plans.set(id, { id, state: "proposed", steps: [...steps, ...proposals] });
        details.plan_id = id;
      }
      tool("propose_change", p, { content: [], details });
    }
    if (has("propose"))
      tool(
        "propose_change",
        { kind: "job_plan" },
        { content: [], details: { kind: "job_plan", pending: true } },
      );
    if (has("write"))
      ledger.push({
        at: Date.now(),
        phase: "turn",
        operation: "jobs",
        method: "POST",
        granted: true,
        outcome: "ok",
      });

    let text = (c && o.answers[`${c.id}#${seen.turn}`]) ?? (isCorrection ? "Changed." : "Here it is.");
    if (has("door")) text += " That door is closed to me.";
    if (has("engine")) text += " The epoch moved on.";
    chunks.push({
      type: "message-delta",
      conversationId: conversation,
      messageId: "m",
      kind: "text",
      delta: text,
    });
    if (has("late-step")) tool("registry_search", { text: "more" }, { content: [], details: {} });
    chunks.push({ type: "message-completed", conversationId: conversation, messageId: "m" });
    return { chunks, ledger };
  };

  const body = async (req: IncomingMessage): Promise<Rec> => {
    let s = "";
    for await (const part of req) s += part;
    try {
      return s ? (JSON.parse(s) as Rec) : {};
    } catch {
      return {};
    }
  };
  const send = (
    res: ServerResponse,
    status: number,
    value: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(value));
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const path = url.pathname;
    try {
      if (req.method === "GET" && path === "/capabilities")
        return send(res, 200, { one_chat: { find: o.arm }, agents: ["nils"] });
      const agent = /^\/agents\/nils\/([^/]+)$/u.exec(path);
      if (agent) {
        const conversation = decodeURIComponent(agent[1]);
        const stream = streams.get(conversation) ?? [];
        streams.set(conversation, stream);
        if (req.method === "POST") {
          const b = await body(req);
          if (b.kind !== "user" || typeof b.body !== "string")
            return send(res, 400, { error: { type: "invalid_request", message: "kind user and a body" } });
          const offset = offsetOf(stream.length);
          const submissionId = `sub-${nextSubmission++}`;
          const { chunks, ledger } = respond(conversation, b.body);
          stream.push({ type: "message-appended", conversationId: conversation, message: { role: "user" } });
          stream.push(...chunks.map((c) => ({ ...c, submissionId })));
          stream.push({
            type: "submission-settled",
            conversationId: conversation,
            submissionId,
            outcome: "completed",
          });
          ledgers.set(conversation, [...(ledgers.get(conversation) ?? []), ...ledger]);
          return send(
            res,
            202,
            { streamUrl: path, offset, submissionId, uid: "stub" },
            { "stream-next-offset": offset },
          );
        }
        if (req.method === "GET" && url.searchParams.get("view") === "updates") {
          const raw = url.searchParams.get("offset") ?? "-1";
          const from = raw === "-1" ? 0 : Number(raw.split("_")[1]);
          // the admitted message is before the admission's offset; everything after it is the turn's
          const out = stream.slice(from).map((c, i) => ({ ...c, position: { batch: from + i, index: 0 } }));
          return send(res, 200, out, {
            "stream-next-offset": offsetOf(stream.length),
            "stream-up-to-date": "true",
          });
        }
      }
      const ledger = /^\/ledger\/([^/]+)$/u.exec(path);
      if (ledger && req.method === "GET")
        return send(res, 200, { rows: ledgers.get(decodeURIComponent(ledger[1])) ?? [] });
      const plan = /^\/plans\/([^/]+)$/u.exec(path);
      if (plan && req.method === "GET") {
        const p = plans.get(decodeURIComponent(plan[1]));
        return p ? send(res, 200, p) : send(res, 404, { error: "no such plan of yours" });
      }
      if (req.method === "POST" && path === "/api/ask/draft") {
        const b = await body(req);
        const file = Object.entries(o.goldTexts).find(([, t]) => t === b.text)?.[0];
        const id = nextDocument++;
        documents.set(id, file ? (o.golds[file]?.content_hash ?? null) : null);
        return send(res, 200, { document: id });
      }
      if (req.method === "POST" && path === "/api/ask/run") {
        const b = await body(req);
        const hash = documents.get(Number(b.document_id));
        // a document that misses answers no rows, so no answer compares equal to a gold's
        return send(res, 200, {
          content_hash: hash ?? null,
          row_count: hash && !hash.endsWith("-not") ? 1 : 0,
          columns: [],
          rows: [],
        });
      }
      if (req.method === "GET" && path === "/api/batches") return send(res, 200, { batches: BATCHES });
      if (req.method === "GET" && path === "/api/ask/documents")
        return send(res, 200, { documents: DOCUMENTS });
      return send(res, 404, { error: `no ${req.method} ${path}` });
    } catch (err) {
      return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** The stub's inputs from the repository: the corpus, the lexicon, the golds and their texts, the answers. */
export function stubInputs(dir = join(process.cwd(), "bench")): Omit<StubOptions, "arm" | "faults"> {
  const conversations = (
    parse(readFileSync(join(dir, "corpus", "one-chat.yml"), "utf8")) as { conversations: Conversation[] }
  ).conversations;
  const lexicon = parse(readFileSync(join(dir, "corpus", "one-chat-lexicon.yml"), "utf8")) as Lexicon;
  const golds = JSON.parse(readFileSync(join(dir, "gold", "expect.json"), "utf8")) as Record<
    string,
    { content_hash: string | null }
  >;
  const goldTexts: Record<string, string> = {};
  for (const f of readdirSync(join(dir, "gold")).filter((f) => f.endsWith(".ask.yml")))
    goldTexts[f] = readFileSync(join(dir, "gold", f), "utf8");
  const answers = (
    parse(readFileSync(join(dir, "one-chat-stub.yml"), "utf8")) as { answers: Record<string, string> }
  ).answers;
  return { conversations, lexicon, golds, goldTexts, answers };
}

/** A digest of the stub's answers, so a test can tell the oracle's text changed. */
export const answersDigest = (answers: Record<string, string>) =>
  createHash("sha256").update(JSON.stringify(answers)).digest("hex").slice(0, 12);

if (process.argv[1] && resolve(process.argv[1]).endsWith(join("bench", "one-chat-stub.js"))) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "7399" },
      arm: { type: "string", default: "skill" },
      fault: { type: "string" },
    },
  });
  const faults: Record<string, Fault[]> = {};
  for (const f of values.fault?.split(",").filter(Boolean) ?? []) {
    const [who, what] = f.includes("=") ? f.split("=") : ["*", f];
    if (!FAULTS.includes(what as Fault)) throw new Error(`no fault ${what}: ${FAULTS.join(", ")}`);
    faults[who] = [...(faults[who] ?? []), what as Fault];
  }
  const server = stub({ ...stubInputs(), arm: values.arm === "subagent" ? "subagent" : "skill", faults });
  server.listen(Number(values.port), "127.0.0.1", () =>
    console.log(`the one-chat stub on http://127.0.0.1:${values.port} (find as ${values.arm})`),
  );
}
